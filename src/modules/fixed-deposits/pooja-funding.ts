import { AccountType } from '../../generated/prisma/enums';
import type { Sides } from '../ledger/ledger-query.service';

const round = (value: number) => Math.round(value * 100) / 100;

export interface PoojaFunding {
  interestReceived: number;
  sponsorTopUps: number;
  spent: number;
  balance: number;
}

export function netIncome(byType: Map<AccountType, Sides> | undefined): number {
  const sides = byType?.get(AccountType.income);

  return sides ? round(sides.credit - sides.debit) : 0;
}

export function netExpense(byType: Map<AccountType, Sides> | undefined): number {
  const sides = byType?.get(AccountType.expense);

  return sides ? round(sides.debit - sides.credit) : 0;
}

// Positive is left over for the general fund; negative is what the sponsor still has to cover.
export function poojaFunding(
  interestReceived: number,
  sponsorTopUps: number,
  spent: number,
): PoojaFunding {
  return {
    interestReceived: round(interestReceived),
    sponsorTopUps: round(sponsorTopUps),
    spent: round(spent),
    balance: round(interestReceived + sponsorTopUps - spent),
  };
}
