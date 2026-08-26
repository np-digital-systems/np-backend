import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';

import { PrismaClient } from '../src/generated/prisma/client';
import { UserRole } from '../src/generated/prisma/enums';

process.loadEnvFile('.env');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PERMISSION_GROUPS = [
  { code: 'accounting', label: 'Accounting', description: 'Vouchers, ledger and the chart of accounts', sortOrder: 1 },
  { code: 'register', label: 'Sanththa register', description: 'Members and their subscriptions', sortOrder: 2 },
  { code: 'events', label: 'Events', description: 'Event types, the calendar and sponsorship', sortOrder: 3 },
  { code: 'assets', label: 'Assets and deposits', description: 'Fixed assets and fixed deposits', sortOrder: 4 },
  { code: 'administration', label: 'Administration', description: 'Users, roles and settings', sortOrder: 5 },
];

const PERMISSIONS = [
  ['voucher:read', 'accounting', 'View vouchers'],
  ['voucher:create', 'accounting', 'Raise vouchers'],
  ['voucher:submit', 'accounting', 'Submit vouchers for approval'],
  ['voucher:approve', 'accounting', 'Approve or reject vouchers'],
  ['voucher:post', 'accounting', 'Post vouchers to the ledger'],
  ['ledger:read', 'accounting', 'View the ledger and reports'],
  ['account:read', 'accounting', 'View the chart of accounts'],
  ['account:manage', 'accounting', 'Maintain the chart of accounts'],
  ['financial-year:manage', 'accounting', 'Open and close financial years'],
  ['member:read', 'register', 'View the sanththa register'],
  ['member:manage', 'register', 'Enrol and update members'],
  ['subscription:record', 'register', 'Record subscription payments'],
  ['event:read', 'events', 'View the event calendar'],
  ['event:manage', 'events', 'Maintain events and event types'],
  ['sponsor:manage', 'events', 'Assign event sponsors'],
  ['asset:read', 'assets', 'View assets and deposits'],
  ['asset:manage', 'assets', 'Maintain assets and deposits'],
  ['users:read', 'administration', 'View users'],
  ['users:create', 'administration', 'Create users'],
  ['users:update', 'administration', 'Update users'],
  ['users:delete', 'administration', 'Deactivate users'],
  ['audit:read', 'administration', 'Read the audit log'],
  ['settings:manage', 'administration', 'Change portal settings'],
] as const;

const ROLES = [
  { code: UserRole.admin, label: 'Administrator', description: 'Full access to the portal', isSystem: true, sortOrder: 1 },
  { code: UserRole.accountant, label: 'Accountant', description: 'Keeps the books and approves vouchers', isSystem: true, sortOrder: 2 },
  { code: UserRole.cashier, label: 'Cashier', description: 'Raises vouchers and collects subscriptions', isSystem: true, sortOrder: 3 },
  { code: UserRole.user, label: 'Devotee', description: 'A member or sponsor with no portal access', isSystem: true, sortOrder: 4 },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  [UserRole.admin]: PERMISSIONS.map(([code]) => code),
  [UserRole.accountant]: [
    'voucher:read', 'voucher:create', 'voucher:submit', 'voucher:approve', 'voucher:post',
    'ledger:read', 'account:read', 'account:manage', 'financial-year:manage',
    'member:read', 'subscription:record', 'event:read', 'asset:read', 'asset:manage',
    'users:read', 'audit:read',
  ],
  [UserRole.cashier]: [
    'voucher:read', 'voucher:create', 'voucher:submit', 'ledger:read', 'account:read',
    'member:read', 'member:manage', 'subscription:record', 'event:read', 'asset:read',
  ],
  [UserRole.user]: [],
};

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
  ]);

  for (const [roleCode, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await prisma.rolePermission.deleteMany({ where: { roleCode: roleCode as UserRole } });

    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permissionCode) => ({ roleCode: roleCode as UserRole, permissionCode })),
      });
    }
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

  console.log(`Seeded ${PERMISSIONS.length} permissions, ${ROLES.length} roles and the admin account (${email}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
