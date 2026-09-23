import { ApiProperty } from '@nestjs/swagger';

import { AccountRefDto } from '../../accounts/dto/account.dto';

/**
 * How far a budget line has got.
 *
 * Read off the ledger and the voucher queue rather than stored: a column
 * saying "paid" is a column that goes on saying it after the voucher behind
 * it is cancelled.
 */
export type BudgetLineStatus = 'Not raised' | 'In progress' | 'Posted';

export class BudgetLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ description: 'The heading as it read on the day it was quoted' })
  label!: string;
  @ApiProperty() accountId!: number;
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() fundId!: number;
  @ApiProperty({ nullable: true }) activityId!: number | null;
  @ApiProperty({ nullable: true }) partyId!: number | null;
  @ApiProperty({ nullable: true }) partyName!: string | null;
  @ApiProperty({ description: 'What the day was planned to cost under this head' })
  budgeted!: number;
  @ApiProperty({ description: 'What it actually cost, from the posted ledger' })
  actual!: number;
  @ApiProperty({ description: 'Actual less budgeted; positive is an overspend' })
  variance!: number;
  @ApiProperty({ description: 'False for what the temple bears itself' })
  chargedToSponsor!: boolean;
  @ApiProperty({ enum: ['Not raised', 'In progress', 'Posted'] })
  status!: BudgetLineStatus;
}

export class EventBudgetDto {
  @ApiProperty() eventId!: number;
  @ApiProperty({ nullable: true, description: 'The costing the figures were taken from' })
  costingId!: number | null;
  @ApiProperty({ nullable: true, description: 'What the sponsor was quoted' })
  sponsorAmount!: number | null;
  @ApiProperty({ nullable: true, description: 'What has actually been receipted from them' })
  sponsorReceived!: number | null;
  @ApiProperty({ type: () => [BudgetLineDto] }) lines!: BudgetLineDto[];
  @ApiProperty() budgetedTotal!: number;
  @ApiProperty() actualTotal!: number;
  @ApiProperty({ description: 'Actual less budgeted across every head' }) variance!: number;
  @ApiProperty({ description: 'Whether the budget may still be corrected' })
  isFrozen!: boolean;
  @ApiProperty({
    nullable: true,
    description: 'Why there is no budget yet, in the words the screen should use',
  })
  problem!: string | null;
}

/** One head this occurrence is expected to spend on. */
export class ExpectedLineDto {
  @ApiProperty() accountId!: number;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

/**
 * What an occurrence is expected to cost, for a form filling itself in.
 *
 * Answered from the frozen budget where the day has been costed, and from the
 * costing in force where it has not. A form has no business preferring one to
 * the other: a day already quoted is owed the figure it was quoted at, and one
 * that has not been quoted yet is owed today's rate.
 */
export class ExpectedAmountsDto {
  @ApiProperty({ description: 'Whether these come from the day’s frozen budget' })
  costed!: boolean;
  @ApiProperty({ nullable: true, description: 'What the sponsor is asked for' })
  sponsorAmount!: number | null;
  @ApiProperty({ type: () => [ExpectedLineDto] })
  lines!: ExpectedLineDto[];
}
