import {
  AssetCategory,
  AssetCondition,
  AssetStatus,
  AuditAction,
  BankAccountType,
  FrequencyType,
  InterestPayout,
  NotificationCategory,
  ProjectStatus,
  VoucherStatus,
} from '../../generated/prisma/enums';
import {
  AssetCategoryWire,
  AssetConditionWire,
  AssetStatusWire,
  AuditActionWire,
  BankAccountTypeWire,
  InterestPayoutWire,
  NotificationCategoryWire,
  ProjectStatusWire,
  VoucherStatusWire,
} from './wire';

/**
 * The values the frontend switches on, read out of its own type declarations.
 * If the database and these ever part company, this suite is what says so.
 */
const CONTRACT = {
  ProjectStatus: ['planning', 'active', 'on-hold', 'completed'],
  BankAccountType: ['current', 'savings', 'fixed-deposit'],
  VoucherStatus: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Posted', 'Cancelled'],
  InterestPayout: ['monthly', 'quarterly', 'on-maturity'],
  AssetCategory: [
    'land-building',
    'jewellery',
    'vahanam',
    'vessels',
    'furniture',
    'equipment',
    'vehicle',
  ],
  AssetCondition: ['good', 'fair', 'needs-repair', 'unusable'],
  AssetStatus: ['in-use', 'in-storage', 'under-repair', 'disposed'],
  AuditAction: [
    'create',
    'update',
    'delete',
    'approve',
    'reject',
    'post',
    'login',
    'logout',
    'permission-change',
  ],
  NotificationCategory: [
    'Approval',
    'Accounting',
    'Event',
    'Sanththa',
    'Banking',
    'Fixed Deposit',
    'Financial Year',
    'User Administration',
    'Security',
    'System',
  ],
};

const CODECS = {
  ProjectStatus: [ProjectStatusWire, ProjectStatus],
  BankAccountType: [BankAccountTypeWire, BankAccountType],
  VoucherStatus: [VoucherStatusWire, VoucherStatus],
  InterestPayout: [InterestPayoutWire, InterestPayout],
  AssetCategory: [AssetCategoryWire, AssetCategory],
  AssetCondition: [AssetConditionWire, AssetCondition],
  AssetStatus: [AssetStatusWire, AssetStatus],
  AuditAction: [AuditActionWire, AuditAction],
  NotificationCategory: [NotificationCategoryWire, NotificationCategory],
} as const;

describe('wire enums', () => {
  for (const [name, expected] of Object.entries(CONTRACT)) {
    const [codec, prismaEnum] = CODECS[name as keyof typeof CODECS];

    it(`${name} publishes exactly the values the frontend expects`, () => {
      expect([...codec.values].sort()).toEqual([...expected].sort());
    });

    it(`${name} round-trips every member`, () => {
      for (const member of Object.values(prismaEnum) as string[]) {
        expect(codec.toPrisma(codec.toWire(member as never) as never)).toBe(member);
      }
    });
  }

  it('FrequencyType needs no translation: its members are already the stored values', () => {
    expect([...Object.values(FrequencyType)].sort()).toEqual(
      ['weekly', 'monthly_twice', 'monthly_once', 'annual', 'multi_day'].sort(),
    );
  });

  it('leaves an unmapped member untouched', () => {
    expect(ProjectStatusWire.toWire(ProjectStatus.active)).toBe('active');
    expect(ProjectStatusWire.toPrismaOptional(undefined)).toBeUndefined();
  });
});
