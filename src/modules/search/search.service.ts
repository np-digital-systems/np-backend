import { Injectable } from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { VoucherStatusWire } from '../../common/enums/wire';
import { VoucherKind } from '../../generated/prisma/enums';
import { PermissionsService } from '../auth/permissions.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deriveEventStatus } from '../events/event-status';
import { QuerySearchDto, SearchResultDto } from './dto/search.dto';

const contains = (search: string) => ({ contains: search, mode: 'insensitive' as const });

/**
 * Global search across the portal.
 *
 * Each source is gated by the permission that guards its own screen, so search
 * can never become a side door onto records the caller cannot otherwise open.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async search(query: QuerySearchDto, user: AuthenticatedUser): Promise<SearchResultDto[]> {
    const granted = await this.permissions.forRole(user.role);
    const take = query.perType ?? 5;
    const q = query.q.trim();
    const may = (permission: string) => granted.has(permission);

    const sources: Promise<SearchResultDto[]>[] = [];

    if (may('user:manage')) sources.push(this.users(q, take));
    if (may('event:view')) sources.push(this.events(q, take));
    if (may('transaction:view')) sources.push(this.vouchers(q, take), this.members(q, take));
    if (may('fund:view')) sources.push(this.funds(q, take));
    if (may('project:view')) sources.push(this.projects(q, take));
    if (may('fixed-deposit:view')) sources.push(this.deposits(q, take));
    if (may('asset:view')) sources.push(this.assets(q, take));

    return (await Promise.all(sources)).flat();
  }

  private async users(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          { nameTa: contains(q) },
          { fullName: contains(q) },
          { email: contains(q) },
          { phone: contains(q) },
        ],
      },
      take,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'User' as const,
      title: row.fullName ?? row.nameTa,
      subtitle: `${row.role.toUpperCase()}${row.phone ? ` · ${row.phone}` : ''}`,
      meta: row.isActive ? 'Active' : 'Inactive',
      ref: row.memberNo,
      badge: null,
      page: 'Users',
    }));
  }

  private async members(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        memberNo: { not: null },
        OR: [{ memberNo: contains(q) }, { nameTa: contains(q) }, { fullName: contains(q) }],
      },
      take,
      orderBy: { memberNo: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      type: 'Sanththa' as const,
      title: row.fullName ?? row.nameTa,
      subtitle: row.address || 'Sanththa member',
      meta: row.subscribes ? 'Subscribing' : 'Not subscribing',
      ref: row.memberNo,
      badge: null,
      page: 'Sanththa Register',
    }));
  }

  private async vouchers(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.voucher.findMany({
      where: { OR: [{ ref: contains(q) }, { party: contains(q) }, { description: contains(q) }] },
      take,
      orderBy: { date: 'desc' },
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: row.kind === VoucherKind.receipt ? ('Receipt' as const) : ('Payment' as const),
      title: row.description,
      subtitle: `${row.date.toISOString().slice(0, 10)} · ${row.party}`,
      meta: `Rs. ${toRupees(row.amount).toLocaleString('en-LK')}`,
      ref: row.ref,
      badge: VoucherStatusWire.toWire(row.status),
      page: row.kind === VoucherKind.receipt ? 'Receipt Vouchers' : 'Payment Vouchers',
    }));
  }

  private async events(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        OR: [
          { customInstanceName: contains(q) },
          { eventType: { nameTa: contains(q) } },
          { eventType: { nameEn: contains(q) } },
        ],
      },
      include: { eventType: true },
      take,
      orderBy: { scheduledDate: 'desc' },
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: 'Event' as const,
      title: row.customInstanceName ?? row.eventType.nameTa,
      subtitle: `${row.scheduledDate.toISOString().slice(0, 10)} · ${row.eventType.nameEn ?? row.eventType.nameTa}`,
      meta: null,
      ref: null,
      badge: deriveEventStatus(row.scheduledDate, row.isCompleted),
      page: 'Event Calendar',
    }));
  }

  private async funds(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.fund.findMany({
      where: { OR: [{ nameTa: contains(q) }, { nameEn: contains(q) }] },
      take,
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: 'Fund' as const,
      title: row.nameEn ?? row.nameTa,
      subtitle: row.nameTa,
      meta: row.isActive ? 'Active' : 'Closed',
      ref: null,
      badge: null,
      page: 'Funds',
    }));
  }

  private async projects(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.project.findMany({
      where: { OR: [{ nameTa: contains(q) }, { nameEn: contains(q) }] },
      include: { fund: true },
      take,
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: 'Project' as const,
      title: row.nameEn ?? row.nameTa,
      subtitle: `${row.fund.nameEn ?? row.fund.nameTa} · from ${row.startDate.toISOString().slice(0, 10)}`,
      meta: row.budget ? `Rs. ${toRupees(row.budget).toLocaleString('en-LK')}` : null,
      ref: null,
      badge: row.status,
      page: 'Projects',
    }));
  }

  private async deposits(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.fixedDeposit.findMany({
      where: { OR: [{ certificateNo: contains(q) }, { bankName: contains(q) }] },
      take,
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: 'Fixed Deposit' as const,
      title: `${row.bankName} · ${row.branch}`,
      subtitle: `Matures ${row.maturesOn.toISOString().slice(0, 10)}`,
      meta: `Rs. ${toRupees(row.principal).toLocaleString('en-LK')}`,
      ref: row.certificateNo,
      badge: row.status,
      page: 'Fixed Deposits',
    }));
  }

  private async assets(q: string, take: number): Promise<SearchResultDto[]> {
    const rows = await this.prisma.asset.findMany({
      where: {
        OR: [
          { tag: contains(q) },
          { nameTa: contains(q) },
          { nameEn: contains(q) },
          { location: contains(q) },
        ],
      },
      take,
    });

    return rows.map((row) => ({
      id: String(row.id),
      type: 'Asset' as const,
      title: row.nameEn ?? row.nameTa,
      subtitle: `${row.category} · ${row.location}`,
      meta: `Rs. ${toRupees(row.cost).toLocaleString('en-LK')}`,
      ref: row.tag,
      badge: row.status,
      page: 'Assets',
    }));
  }
}
