import { ApiProperty } from '@nestjs/swagger';

import { AccountRefDto } from '../../accounts/dto/account.dto';

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

export class ExpectedLineDto {
  @ApiProperty() accountId!: number;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

export class ExpectedAmountsDto {
  @ApiProperty({ description: 'Whether these come from the day’s frozen budget' })
  costed!: boolean;
  @ApiProperty({ nullable: true, description: 'What the sponsor is asked for' })
  sponsorAmount!: number | null;
  @ApiProperty({ type: () => [ExpectedLineDto] })
  lines!: ExpectedLineDto[];
}
