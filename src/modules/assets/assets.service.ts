import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { toRupees, toRupeesOrNull } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AssetStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assetMaths } from './asset-maths';
import {
  AssetCategoryTotalDto,
  AssetRecordDto,
  CreateAssetDto,
  DisposeAssetDto,
  QueryAssetsDto,
  UpdateAssetDto,
} from './dto/asset.dto';

type AssetRow = Prisma.AssetGetPayload<{ include: { fund: true } }>;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryAssetsDto): Promise<AssetRecordDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        category: query.category,
        status: query.heldOnly ? { not: AssetStatus.disposed } : query.status,
        condition: query.condition,
        fundId: query.fundId,
      },
      include: { fund: true },
      orderBy: { tag: 'asc' },
    });

    return assets.map((asset) => this.toRecord(asset));
  }

  async findOneOrFail(id: number): Promise<AssetRecordDto> {
    const asset = await this.prisma.asset.findUnique({ where: { id }, include: { fund: true } });

    if (!asset) throw new NotFoundException(`Asset ${id} was not found`);

    return this.toRecord(asset);
  }

  async byCategory(): Promise<AssetCategoryTotalDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: { status: { not: AssetStatus.disposed } },
      include: { fund: true },
    });

    const totals = new Map<string, AssetCategoryTotalDto>();

    for (const asset of assets) {
      const record = this.toRecord(asset);
      const current = totals.get(record.category) ?? {
        category: record.category,
        count: 0,
        cost: 0,
        netBookValue: 0,
      };

      current.count += 1;
      current.cost += record.cost;
      current.netBookValue += record.netBookValue;

      totals.set(record.category, current);
    }

    return [...totals.values()]
      .map((total) => ({
        ...total,
        cost: Math.round(total.cost * 100) / 100,
        netBookValue: Math.round(total.netBookValue * 100) / 100,
      }))
      .sort((a, b) => b.cost - a.cost);
  }

  async create(dto: CreateAssetDto, context: ActorContext): Promise<AssetRecordDto> {
    await this.assertFundIsActive(dto.fundId);

    const asset = await this.prisma.asset.create({
      data: {
        tag: dto.tag,
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        category: dto.category,
        acquiredOn: new Date(dto.acquiredOn),
        cost: dto.cost,
        depreciationRate: dto.depreciationRate ?? 0,
        location: dto.location,
        condition: dto.condition,
        status: dto.status,
        fundId: dto.fundId,
        notes: dto.notes,
      },
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'asset',
      entityRef: asset.tag,
      summary: `Capitalised ${asset.nameTa} (${asset.tag}) at ${toRupees(asset.cost)}`,
    });

    return this.toRecord(asset);
  }

  async update(id: number, dto: UpdateAssetDto, context: ActorContext): Promise<AssetRecordDto> {
    const before = await this.prisma.asset.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Asset ${id} was not found`);
    if (before.status === AssetStatus.disposed) {
      throw new ConflictException(`${before.tag} has been disposed of and is now a closed record`);
    }

    if (dto.status === AssetStatus.disposed) {
      throw new BadRequestException('Use POST /assets/:id/dispose so the disposal is dated');
    }

    if (dto.fundId !== undefined) await this.assertFundIsActive(dto.fundId);

    const asset = await this.prisma.asset.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        category: dto.category,
        acquiredOn: dto.acquiredOn ? new Date(dto.acquiredOn) : undefined,
        cost: dto.cost,
        depreciationRate: dto.depreciationRate,
        location: dto.location,
        condition: dto.condition,
        status: dto.status,
        fundId: dto.fundId,
        notes: dto.notes,
      },
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'asset',
      entityRef: asset.tag,
      summary: `Updated ${asset.nameTa} (${asset.tag})`,
      diff: AuditService.diff(
        { ...before, cost: toRupees(before.cost) },
        { ...asset, cost: toRupees(asset.cost), fund: undefined },
      ),
    });

    return this.toRecord(asset);
  }

  /**
   * Part the temple from something it owns.
   *
   * Dating the disposal is what stops depreciation, so this is a distinct
   * action rather than a status field anyone can set.
   */
  async dispose(id: number, dto: DisposeAssetDto, context: ActorContext): Promise<AssetRecordDto> {
    const before = await this.prisma.asset.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Asset ${id} was not found`);
    if (before.status === AssetStatus.disposed) {
      throw new ConflictException(`${before.tag} was already disposed of`);
    }

    const disposedOn = new Date(dto.disposedOn);

    if (disposedOn < before.acquiredOn) {
      throw new BadRequestException('An asset cannot be disposed of before it was acquired');
    }

    const asset = await this.prisma.asset.update({
      where: { id },
      data: {
        status: AssetStatus.disposed,
        disposedOn,
        disposalValue: dto.disposalValue,
        notes: dto.notes ?? before.notes,
      },
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'asset',
      entityRef: asset.tag,
      summary: `Disposed of ${asset.nameTa} (${asset.tag}) for ${dto.disposalValue ?? 0}`,
      diff: {
        disposedOn: dto.disposedOn,
        disposalValue: dto.disposalValue ?? null,
        netBookValueAtDisposal: this.toRecord(asset).netBookValue,
      },
    });

    return this.toRecord(asset);
  }

  private async assertFundIsActive(fundId: number): Promise<void> {
    const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

    if (!fund) throw new NotFoundException(`Fund ${fundId} was not found`);
    if (!fund.isActive) throw new BadRequestException(`Fund ${fund.nameTa} is closed`);
  }

  private toRecord(asset: AssetRow): AssetRecordDto {
    const cost = toRupees(asset.cost);
    const rate = toRupees(asset.depreciationRate);
    const maths = assetMaths(cost, rate, asset.acquiredOn, asset.disposedOn);

    return {
      id: asset.id,
      tag: asset.tag,
      name: asset.nameEn ?? asset.nameTa,
      nameTa: asset.nameTa,
      category: asset.category,
      acquiredOn: asset.acquiredOn.toISOString().slice(0, 10),
      cost,
      depreciationRate: rate,
      location: asset.location,
      condition: asset.condition,
      status: asset.status,
      fundId: asset.fundId,
      fundName: asset.fund.nameEn ?? asset.fund.nameTa,
      disposedOn: asset.disposedOn?.toISOString().slice(0, 10) ?? null,
      disposalValue: toRupeesOrNull(asset.disposalValue),
      notes: asset.notes,
      ...maths,
    };
  }
}
