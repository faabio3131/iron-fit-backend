import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RecordAggregatorSettlementDto } from './dto/record-aggregator-settlement.dto';
import { AggregatorSettlementLedgerService } from './aggregator-settlement-ledger.service';

@Controller('aggregator/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorSettlementController {
  constructor(private readonly settlements: AggregatorSettlementLedgerService) {}

  @Post('evidence')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  record(
    @Body() dto: RecordAggregatorSettlementDto,
    @CurrentUser() user: any,
  ) {
    return this.settlements.recordProviderSettlement(
      dto,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }
}
