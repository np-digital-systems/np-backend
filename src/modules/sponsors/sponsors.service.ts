import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { PartyType } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  EnrolSponsorDto,
  QuerySponsorRegisterDto,
  SponsorDto,
  SponsorRegisterRowDto,
  UpdateSponsorProfileDto,
} from './dto/sponsor-registry.dto';

const SPONSOR_INCLUDE = {
  party: {
    select: {
      nameTa: true,
      nameEn: true,
      phone: true,
      email: true,
      address: true,
      _count: { select: { sponsorships: true } },
    },
  },
} satisfies Prisma.MemberInclude;

type SponsorRow = Prisma.MemberGetPayload<{ include: typeof SPONSOR_INCLUDE }>;

const round = (value: number) => Math.round(value * 100) / 100;

// Pooja sponsors always owe the yearly sanththa; any other member only if they opted in.
export const OWES_SANTHTHA = {
  OR: [{ subscribes: true }, { party: { sponsorships: { some: {} } } }],
} satisfies Prisma.MemberWhereInput;

// A member is a party with a register entry: identity lives on the party, only membership fields here.
@Injectable()
export class SponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async register(
    query: QuerySponsorRegisterDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SponsorRegisterRowDto>> {
    const year = query.year ?? new Date().getFullYear();

    const search = query.search
      ? {
          OR: [
            { memberNo: { contains: query.search, mode: 'insensitive' as const } },
            { party: { nameTa: { contains: query.search, mode: 'insensitive' as const } } },
            { party: { nameEn: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const where: Prisma.MemberWhereInput = {
      isActive: query.isActive,
      AND: [
        search,
        ...(query.outstandingOnly ? [OWES_SANTHTHA, { payments: { none: { year } } }] : []),
      ],
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.member.findMany({
        where,
        include: {
          ...SPONSOR_INCLUDE,
          payments: { select: { year: true, amount: true } },
        },
        orderBy: { memberNo: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    const data = rows.map((row) => ({
      ...this.toDto(row, canSeeContact),
      paidYears: row.payments.map((payment) => payment.year).sort((a, b) => b - a),
      totalPaid: round(row.payments.reduce((sum, payment) => sum + toRupees(payment.amount), 0)),
      paidThisYear: row.payments.some((payment) => payment.year === year),
    }));

    return new PageDto(data, new PageMetaDto(query.page, query.limit, total));
  }

  async findOneOrFail(partyId: number, canSeeContact = true): Promise<SponsorDto> {
    const sponsor = await this.prisma.member.findUnique({
      where: { partyId },
      include: SPONSOR_INCLUDE,
    });

    if (!sponsor) throw new NotFoundException(`Party ${partyId} is not a sponsor`);

    return this.toDto(sponsor, canSeeContact);
  }

  async enrol(dto: EnrolSponsorDto, context: ActorContext): Promise<SponsorDto> {
    if (!dto.partyId && !dto.nameTa) {
      throw new BadRequestException('Give either an existing partyId or a name to register');
    }

    const sponsor = await this.prisma.$transaction(async (tx) => {
      const partyId = dto.partyId ?? (await this.registerPerson(tx, dto));

      const party = await tx.party.findUnique({
        where: { id: partyId },
        select: { id: true, type: true, isActive: true, member: { select: { partyId: true } } },
      });

      if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
      if (party.type !== PartyType.person) {
        throw new BadRequestException('Only a person can be enrolled as a sponsor');
      }
      if (!party.isActive) throw new BadRequestException('That party is no longer active');
      if (party.member) throw new ConflictException('That party is already a sponsor');

      if (dto.partyId) {
        await tx.party.update({
          where: { id: partyId },
          data: { phone: dto.phone, email: dto.email, address: dto.address },
          select: { id: true },
        });
      }

      return tx.member.create({
        data: {
          partyId,
          memberNo: '',
          memberSince: dto.sponsorSince ? new Date(dto.sponsorSince) : new Date(),
          subscribes: dto.subscribes ?? false,
          notes: dto.notes ?? null,
        },
        include: SPONSOR_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'sponsor',
      entityRef: String(sponsor.partyId),
      summary: `Enrolled ${this.nameOf(sponsor)} on the member register as ${sponsor.memberNo}`,
    });

    return this.toDto(sponsor, true);
  }

  // Edits the underlying party, so a rename applies everywhere.
  async update(
    partyId: number,
    dto: UpdateSponsorProfileDto,
    context: ActorContext,
  ): Promise<SponsorDto> {
    const before = await this.prisma.member.findUnique({
      where: { partyId },
      include: SPONSOR_INCLUDE,
    });

    if (!before) throw new NotFoundException(`Party ${partyId} is not a sponsor`);

    const sponsor = await this.prisma.$transaction(async (tx) => {
      await tx.party.update({
        where: { id: partyId },
        data: {
          nameTa: dto.nameTa,
          nameEn: dto.nameEn,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
        },
        select: { id: true },
      });

      return tx.member.update({
        where: { partyId },
        data: { subscribes: dto.subscribes, isActive: dto.isActive, notes: dto.notes },
        include: SPONSOR_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'sponsor',
      entityRef: String(partyId),
      summary: `Updated the sponsor ${this.nameOf(sponsor)}`,
      diff: AuditService.diff({ ...this.toDto(before, true) }, { ...this.toDto(sponsor, true) }),
    });

    return this.toDto(sponsor, true);
  }

  async retire(partyId: number, context: ActorContext): Promise<SponsorDto> {
    return this.update(partyId, { isActive: false }, context);
  }

  private async registerPerson(
    tx: Prisma.TransactionClient,
    dto: EnrolSponsorDto,
  ): Promise<number> {
    const party = await tx.party.create({
      data: {
        type: PartyType.person,
        nameTa: dto.nameTa!,
        nameEn: dto.nameEn ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
      },
      select: { id: true },
    });

    return party.id;
  }

  private toDto(sponsor: SponsorRow, canSeeContact: boolean): SponsorDto {
    return {
      partyId: sponsor.partyId,
      sponsorNo: sponsor.memberNo,
      name: sponsor.party.nameTa,
      nameEn: sponsor.party.nameEn ?? '',
      phone: canSeeContact ? sponsor.party.phone : null,
      email: canSeeContact ? sponsor.party.email : null,
      address: canSeeContact ? sponsor.party.address : null,
      sponsorSince: sponsor.memberSince,
      subscribes: sponsor.subscribes,
      owesSanththa: sponsor.subscribes || sponsor.party._count.sponsorships > 0,
      isActive: sponsor.isActive,
      notes: sponsor.notes,
      sponsorships: sponsor.party._count.sponsorships,
    };
  }

  private nameOf(sponsor: SponsorRow): string {
    return sponsor.party.nameEn ?? sponsor.party.nameTa;
  }
}
