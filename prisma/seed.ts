import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';

import { PrismaClient } from '../src/generated/prisma/client';
import { UserRole } from '../src/generated/prisma/enums';

process.loadEnvFile('.env');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PERMISSION_GROUPS = [
  { code: 'dashboard', label: 'Dashboard', description: 'The portal landing view', sortOrder: 1 },
  { code: 'accounting', label: 'Accounting', description: 'Vouchers, the ledger, books and bank accounts', sortOrder: 2 },
  { code: 'finance', label: 'Funds and property', description: 'Funds, projects, deposits, assets and reports', sortOrder: 3 },
  { code: 'events', label: 'Events', description: 'The calendar, event types and sponsorship', sortOrder: 4 },
  { code: 'register', label: 'Sanththa register', description: 'Members and their yearly subscriptions', sortOrder: 5 },
  { code: 'administration', label: 'Administration', description: 'Users, roles, the audit trail and settings', sortOrder: 6 },
];

const PERMISSIONS = [
  ['dashboard:view', 'dashboard', 'View the dashboard'],

  ['account:view', 'accounting', 'View the chart of accounts'],
  ['account:manage', 'accounting', 'Maintain the chart of accounts'],
  ['transaction:view', 'accounting', 'View posted transactions'],
  ['transaction:create', 'accounting', 'Record transactions'],
  ['transaction:export', 'accounting', 'Export transactions'],
  ['receipt-voucher:view', 'accounting', 'View receipt vouchers'],
  ['receipt-voucher:create', 'accounting', 'Raise receipt vouchers'],
  ['payment-voucher:view', 'accounting', 'View payment vouchers'],
  ['payment-voucher:create', 'accounting', 'Raise payment vouchers'],
  ['voucher:create', 'accounting', 'Create vouchers'],
  ['voucher:submit', 'accounting', 'Submit vouchers for approval'],
  ['voucher:approve', 'accounting', 'Approve or reject vouchers'],
  ['voucher:post', 'accounting', 'Post vouchers to the ledger'],
  ['voucher:manage-all', 'accounting', "Act on other people's vouchers"],
  ['cash-book:view', 'accounting', 'View the cash book'],
  ['bank-book:view', 'accounting', 'View the bank book'],
  ['bank-account:view', 'accounting', 'View bank accounts'],
  ['bank-account:manage', 'accounting', 'Open and maintain bank accounts'],
  ['financial-year:view', 'accounting', 'View financial years'],
  ['financial-year:manage', 'accounting', 'Open and close financial years'],

  ['fund:view', 'finance', 'View funds'],
  ['fund:manage', 'finance', 'Maintain funds'],
  ['project:view', 'finance', 'View projects'],
  ['project:manage', 'finance', 'Maintain projects'],
  ['fixed-deposit:view', 'finance', 'View fixed deposits'],
  ['fixed-deposit:manage', 'finance', 'Place and renew fixed deposits'],
  ['asset:view', 'finance', 'View assets'],
  ['asset:manage', 'finance', 'Maintain the asset register'],
  ['asset:dispose', 'finance', 'Dispose of or write off an asset'],
  ['report:generate', 'finance', 'Generate reports'],

  ['event:view', 'events', 'View the event calendar'],
  ['event:create', 'events', 'Add events to the calendar'],
  ['event:update', 'events', 'Change calendared events'],
  ['event:delete', 'events', 'Remove events from the calendar'],
  ['event:complete', 'events', 'Mark events complete'],
  ['event:export', 'events', 'Export the calendar'],
  ['event-type:manage', 'events', 'Maintain event types'],
  ['event-schedule:view', 'events', 'View the yearly schedule'],
  ['event-sponsor:view', 'events', 'View sponsorship assignments'],
  ['event-sponsor:manage', 'events', 'Assign sponsors and see their contact details'],

  ['contribution:view', 'register', 'View the sanththa register'],
  ['contribution:record', 'register', 'Record subscription payments'],
  ['contribution:manage', 'register', 'Enrol members and see their contact details'],

  ['user:manage', 'administration', 'Manage users and staff accounts'],
  ['role:manage', 'administration', 'Change what a role may do'],
  ['audit:view', 'administration', 'Read the audit trail'],
  ['settings:manage', 'administration', 'Change portal settings'],
] as const;

const ROLES = [
  { code: UserRole.admin, label: 'Administrator', description: 'Full access to the portal', isSystem: true, sortOrder: 1 },
  { code: UserRole.accountant, label: 'Accountant', description: 'Keeps the books and approves vouchers', isSystem: true, sortOrder: 2 },
  { code: UserRole.cashier, label: 'Cashier', description: 'Collects at the hundial and raises vouchers', isSystem: true, sortOrder: 3 },
  { code: UserRole.user, label: 'Devotee', description: 'A member or sponsor with no operational access', isSystem: true, sortOrder: 4 },
];

const ACCOUNTANT = [
  'dashboard:view',
  'account:view', 'account:manage',
  'transaction:view', 'transaction:create', 'transaction:export',
  'receipt-voucher:view', 'receipt-voucher:create',
  'payment-voucher:view', 'payment-voucher:create',
  'voucher:create', 'voucher:submit', 'voucher:approve', 'voucher:post', 'voucher:manage-all',
  'cash-book:view', 'bank-book:view', 'bank-account:view',
  'fund:view', 'fund:manage', 'project:view', 'project:manage',
  'fixed-deposit:view', 'asset:view', 'asset:manage', 'report:generate',
  'event:view', 'event:export', 'event-schedule:view', 'event-sponsor:view',
  'financial-year:view',
  'contribution:view', 'contribution:record', 'contribution:manage',
];

const CASHIER = [
  'dashboard:view',
  'transaction:view', 'transaction:create',
  'receipt-voucher:view', 'receipt-voucher:create',
  'payment-voucher:view', 'payment-voucher:create',
  'voucher:create', 'voucher:submit',
  'cash-book:view',
  'event:view', 'event-schedule:view', 'event-sponsor:view',
  'financial-year:view',
  'contribution:view', 'contribution:record',
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  [UserRole.admin]: PERMISSIONS.map(([code]) => code),
  [UserRole.accountant]: ACCOUNTANT,
  [UserRole.cashier]: CASHIER,
  [UserRole.user]: ['dashboard:view', 'event:view'],
};

/*
 * Prisma gives a batch transaction five seconds by default, which is generous
 * against a database on the same machine and not nearly enough against a
 * managed one in another region: every statement in the batch is its own round
 * trip, and sixty of them to Singapore outlast the default before any of them
 * is slow. The work here is small and runs once, so the limit is raised to
 * something a distant database can meet.
 */
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 120_000 };

async function main(): Promise<void> {
  await prisma.$transaction([
    ...PERMISSION_GROUPS.map((group) =>
      prisma.permissionGroup.upsert({ where: { code: group.code }, create: group, update: group }),
    ),
    ...PERMISSIONS.map(([code, groupCode, label], index) =>
      prisma.permission.upsert({
        where: { code },
        create: { code, groupCode, label, sortOrder: index },
        update: { groupCode, label, sortOrder: index },
      }),
    ),
    ...ROLES.map((role) =>
      prisma.role.upsert({ where: { code: role.code }, create: role, update: role }),
    ),
  ], TRANSACTION_OPTIONS);

  const codes = PERMISSIONS.map(([code]) => code);

  await prisma.permission.deleteMany({ where: { code: { notIn: codes } } });
  await prisma.permissionGroup.deleteMany({
    where: { code: { notIn: PERMISSION_GROUPS.map((group) => group.code) } },
  });

  for (const [roleCode, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleCode: roleCode as UserRole } }),
      prisma.rolePermission.createMany({
        data: permissions.map((permissionCode) => ({
          roleCode: roleCode as UserRole,
          permissionCode,
        })),
      }),
    ], TRANSACTION_OPTIONS);
  }

  await prisma.setting.upsert({
    where: { key: 'temple' },
    create: {
      key: 'temple',
      value: {
        nameTa: 'நீலியம்பதி பிள்ளையார் கோவில்',
        nameEn: 'Neeliyampathi Pillaiyar Kovil',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
      },
    },
    update: {},
  });

  await prisma.setting.upsert({
    where: { key: 'locale' },
    create: { key: 'locale', value: { default: 'ta', supported: ['ta', 'en'] } },
    update: {},
  });

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@kovil.lk';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';

  await prisma.user.upsert({
    where: { email },
    create: {
      nameTa: 'நிர்வாகி',
      fullName: 'Portal Administrator',
      email,
      passwordHash: await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
      role: UserRole.admin,
      address: '',
    },
    update: {},
  });

  console.log(
    `Seeded ${PERMISSIONS.length} permissions across ${PERMISSION_GROUPS.length} groups, ` +
      `${ROLES.length} roles and the admin account (${email}).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
