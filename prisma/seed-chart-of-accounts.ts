/*
 * A starting chart of accounts, and the funds it is held in.
 *
 * THE CODES BELOW ARE A PROPOSAL, NOT A DECISION. Numbering a chart of accounts
 * is the committee's call and their accountant's, and it is close to permanent:
 * once vouchers are posted against a head, renumbering it means a data
 * migration. Read this list with them, change it, and only then run it.
 *
 * Every head a costing needs is here — the sponsorship income the receipt lands
 * on, and the expense heads a pooja is quoted from. Groups are not postable:
 * entries go on the leaves, and the tree is what makes a report roll up.
 *
 *   npm run db:seed:chart
 *
 * It is idempotent — matched on `code`, so running it twice changes nothing and
 * a head somebody has since renamed is left with the name they gave it.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { AccountType } from '../src/generated/prisma/enums';

process.loadEnvFile('.env');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Head {
  code: string;
  nameTa: string;
  nameEn: string;
  type: AccountType;
  /** A group. Entries go on its children, never on it. */
  isGroup?: boolean;
  parent?: string;
}

const FUNDS = [
  {
    nameTa: 'பொது நிதி',
    nameEn: 'General Fund',
    note: 'Everything not earmarked for something narrower',
  },
  {
    nameTa: 'திருவிழா நிதி',
    nameEn: 'Festival Fund',
    note: 'The Mahotsavam and the observances around it',
  },
];

const HEADS: Head[] = [
  // ── assets ────────────────────────────────────────────────────────────────
  { code: '1000', nameTa: 'சொத்துக்கள்', nameEn: 'Assets', type: AccountType.asset, isGroup: true },
  {
    code: '1100',
    nameTa: 'கையிருப்பு',
    nameEn: 'Cash in Hand',
    type: AccountType.asset,
    parent: '1000',
  },

  // ── income ────────────────────────────────────────────────────────────────
  { code: '4000', nameTa: 'வருமானம்', nameEn: 'Income', type: AccountType.income, isGroup: true },
  {
    code: '4100',
    nameTa: 'அனுசரணை',
    nameEn: 'Sponsorship',
    type: AccountType.income,
    isGroup: true,
    parent: '4000',
  },
  {
    code: '4110',
    nameTa: 'பூஜை அனுசரணை',
    nameEn: 'Pooja Sponsorship',
    type: AccountType.income,
    parent: '4100',
  },
  {
    code: '4120',
    nameTa: 'திருவிழா அனுசரணை',
    nameEn: 'Festival Sponsorship',
    type: AccountType.income,
    parent: '4100',
  },
  {
    code: '4200',
    nameTa: 'காணிக்கை',
    nameEn: 'Offerings',
    type: AccountType.income,
    isGroup: true,
    parent: '4000',
  },
  { code: '4210', nameTa: 'உண்டியல்', nameEn: 'Hundial', type: AccountType.income, parent: '4200' },

  // ── expenditure ───────────────────────────────────────────────────────────
  {
    code: '5000',
    nameTa: 'செலவுகள்',
    nameEn: 'Expenditure',
    type: AccountType.expense,
    isGroup: true,
  },

  {
    code: '5100',
    nameTa: 'ஊதியங்கள்',
    nameEn: 'Wages and Honoraria',
    type: AccountType.expense,
    isGroup: true,
    parent: '5000',
  },
  {
    code: '5101',
    nameTa: 'குருக்கள் சம்பளம்',
    nameEn: 'Kurukkal Salary',
    type: AccountType.expense,
    parent: '5100',
  },
  {
    code: '5150',
    nameTa: 'உதவியாளர் கூலி',
    nameEn: 'Helper Wages',
    type: AccountType.expense,
    parent: '5100',
  },
  /*
   * One head for the ther driver, the vadam helpers and the marshals together.
   * Not one head per person: an account is a category and a party is a person,
   * and `ledger_entries.party_id` already answers "how much has this man had".
   */
  {
    code: '5160',
    nameTa: 'திருவிழா கூலி',
    nameEn: 'Festival Labour',
    type: AccountType.expense,
    parent: '5100',
  },

  {
    code: '5200',
    nameTa: 'பூஜைப் பொருட்கள்',
    nameEn: 'Pooja Materials',
    type: AccountType.expense,
    isGroup: true,
    parent: '5000',
  },
  /*
   * One head, not one per item. Coconut, milk and curd are the itemisation of a
   * quote — they live on the costing's items, which is where the sponsor sees
   * them. The goods are bought in one purchase from one shop, so the books want
   * one line. Split this into child heads only if the temple ever starts buying
   * them separately and wants each in the ledger.
   */
  {
    code: '5210',
    nameTa: 'பூஜைச் சாமான்',
    nameEn: 'Pooja Goods',
    type: AccountType.expense,
    parent: '5200',
  },
  {
    code: '5220',
    nameTa: 'மலர் மாலை',
    nameEn: 'Flowers and Garlands',
    type: AccountType.expense,
    parent: '5200',
  },
  {
    code: '5230',
    nameTa: 'அன்னதானம்',
    nameEn: 'Annathanam',
    type: AccountType.expense,
    parent: '5200',
  },

  {
    code: '5300',
    nameTa: 'சேவைகள்',
    nameEn: 'Services',
    type: AccountType.expense,
    isGroup: true,
    parent: '5000',
  },
  { code: '5310', nameTa: 'மேளம்', nameEn: 'Melam', type: AccountType.expense, parent: '5300' },
  {
    code: '5320',
    nameTa: 'ஒலிபெருக்கி',
    nameEn: 'Sound',
    type: AccountType.expense,
    parent: '5300',
  },
  {
    code: '5330',
    nameTa: 'அலங்காரம்',
    nameEn: 'Lighting and Decoration',
    type: AccountType.expense,
    parent: '5300',
  },

  {
    code: '5400',
    nameTa: 'பொது வசதிகள்',
    nameEn: 'Utilities',
    type: AccountType.expense,
    isGroup: true,
    parent: '5000',
  },
  {
    code: '5410',
    nameTa: 'மின்சாரம்',
    nameEn: 'Electricity',
    type: AccountType.expense,
    parent: '5400',
  },
  { code: '5420', nameTa: 'நீர்', nameEn: 'Water', type: AccountType.expense, parent: '5400' },
];

async function main(): Promise<void> {
  for (const fund of FUNDS) {
    await prisma.fund.upsert({
      where: { nameTa: fund.nameTa },
      create: { nameTa: fund.nameTa, nameEn: fund.nameEn },
      update: {},
    });
  }

  // Parents before children, so `parent_id` always has something to point at.
  const byCode = new Map<string, number>();

  for (const head of HEADS) {
    const parentId = head.parent ? (byCode.get(head.parent) ?? null) : null;

    if (head.parent && parentId === null) {
      throw new Error(`${head.code} names parent ${head.parent}, which is listed after it`);
    }

    const account = await prisma.account.upsert({
      where: { code: head.code },
      create: {
        code: head.code,
        nameTa: head.nameTa,
        nameEn: head.nameEn,
        type: head.type,
        parentId,
        isPostable: !head.isGroup,
      },
      update: {},
    });

    byCode.set(head.code, account.id);
  }

  /*
   * Cash movements need a head to post their contra against, and until one is
   * named every voucher fails at posting with a message about settings. There
   * is nothing to decide here — it is the cash head that was just created — so
   * it is set rather than left as a step somebody has to find out about.
   */
  const cashAccountId = byCode.get('1100');
  const existing = await prisma.setting.findUnique({ where: { key: 'accounting' } });
  const stored = (existing?.value ?? {}) as Record<string, unknown>;

  if (stored.cashAccountId == null && cashAccountId) {
    await prisma.setting.upsert({
      where: { key: 'accounting' },
      create: { key: 'accounting', value: { ...stored, cashAccountId } },
      update: { value: { ...stored, cashAccountId } },
    });
  }

  const groups = HEADS.filter((head) => head.isGroup).length;

  console.log(
    `Seeded ${FUNDS.length} funds and ${HEADS.length} accounts ` +
      `(${groups} groups, ${HEADS.length - groups} postable heads). ` +
      'Read the codes with the committee before anything is posted against them.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
