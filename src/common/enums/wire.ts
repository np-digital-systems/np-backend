import {
  AssetCategory,
  AssetCondition,
  AssetStatus,
  AuditAction,
  BankAccountType,
  InterestPayout,
  NotificationCategory,
  ProjectStatus,
  VoucherStatus,
} from '../../generated/prisma/enums';

/**
 * The wire spelling of every enum whose database value is not a valid
 * identifier.
 *
 * Prisma names an enum member `onHold` and stores `on-hold`; the client only
 * ever sees the stored spelling. Translating here keeps the published contract
 * independent of the ORM's identifier rules, rather than leaking `onHold` to a
 * frontend that switches on `on-hold`.
 */
interface Codec<Prisma extends string, Wire extends string> {
  readonly values: readonly Wire[];
  toWire(value: Prisma): Wire;
  toPrisma(value: Wire): Prisma;
  toPrismaOptional(value: Wire | undefined | null): Prisma | undefined;
}

function codec<P extends string, W extends string>(
  members: Record<string, P>,
  overrides: Record<string, W> = {},
): Codec<P, W> {
  const forward = new Map<P, W>();
  const backward = new Map<W, P>();

  for (const [key, prismaValue] of Object.entries(members)) {
    const wireValue = overrides[key] ?? prismaValue;

    forward.set(prismaValue, wireValue);
    backward.set(wireValue, prismaValue);
  }

  return {
    values: [...forward.values()],
    toWire: (value) => forward.get(value) ?? (value as unknown as W),
    toPrisma: (value) => backward.get(value) ?? (value as unknown as P),
    toPrismaOptional: (value) =>
      value === undefined || value === null
        ? undefined
        : (backward.get(value) ?? (value as unknown as P)),
  };
}

export type WireProjectStatus = 'planning' | 'active' | 'on-hold' | 'completed';
export const ProjectStatusWire = codec<ProjectStatus, WireProjectStatus>(ProjectStatus, {
  onHold: 'on-hold',
});

export type WireBankAccountType = 'current' | 'savings' | 'fixed-deposit';
export const BankAccountTypeWire = codec<BankAccountType, WireBankAccountType>(BankAccountType, {
  fixedDeposit: 'fixed-deposit',
});

export type WireVoucherStatus =
  'Draft' | 'Pending Approval' | 'Approved' | 'Rejected' | 'Posted' | 'Cancelled';
export const VoucherStatusWire = codec<VoucherStatus, WireVoucherStatus>(VoucherStatus, {
  PendingApproval: 'Pending Approval',
});

export type WireInterestPayout = 'monthly' | 'quarterly' | 'on-maturity';
export const InterestPayoutWire = codec<InterestPayout, WireInterestPayout>(InterestPayout, {
  onMaturity: 'on-maturity',
});

export type WireAssetCategory =
  'land-building' | 'jewellery' | 'vahanam' | 'vessels' | 'furniture' | 'equipment' | 'vehicle';
export const AssetCategoryWire = codec<AssetCategory, WireAssetCategory>(AssetCategory, {
  landBuilding: 'land-building',
});

export type WireAssetCondition = 'good' | 'fair' | 'needs-repair' | 'unusable';
export const AssetConditionWire = codec<AssetCondition, WireAssetCondition>(AssetCondition, {
  needsRepair: 'needs-repair',
});

export type WireAssetStatus = 'in-use' | 'in-storage' | 'under-repair' | 'disposed';
export const AssetStatusWire = codec<AssetStatus, WireAssetStatus>(AssetStatus, {
  inUse: 'in-use',
  inStorage: 'in-storage',
  underRepair: 'under-repair',
});

export type WireAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'post'
  | 'login'
  | 'logout'
  | 'permission-change';
export const AuditActionWire = codec<AuditAction, WireAuditAction>(AuditAction, {
  permissionChange: 'permission-change',
});

export type WireNotificationCategory =
  | 'Approval'
  | 'Accounting'
  | 'Event'
  | 'Sanththa'
  | 'Banking'
  | 'Fixed Deposit'
  | 'Financial Year'
  | 'User Administration'
  | 'Security'
  | 'System';
export const NotificationCategoryWire = codec<NotificationCategory, WireNotificationCategory>(
  NotificationCategory,
  {
    FixedDeposit: 'Fixed Deposit',
    FinancialYear: 'Financial Year',
    UserAdministration: 'User Administration',
  },
);
