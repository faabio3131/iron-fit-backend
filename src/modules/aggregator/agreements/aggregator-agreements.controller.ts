import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AggregatorAgreementsService } from './aggregator-agreements.service';
import { CreateAggregatorAgreementDto } from './dto/create-aggregator-agreement.dto';
import { SignAggregatorAgreementDto } from './dto/sign-aggregator-agreement.dto';
import { RevokeAggregatorAgreementDto } from './dto/revoke-aggregator-agreement.dto';

@Controller('aggregator/agreements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AggregatorAgreementsController {
  constructor(private readonly agreements: AggregatorAgreementsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  register(
    @Body() dto: CreateAggregatorAgreementDto,
    @CurrentUser() user: any,
  ) {
    return this.agreements.register(
      dto,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Get('member/:memberId/current')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  current(@Param('memberId') memberId: string, @CurrentUser() user: any) {
    return this.agreements.findCurrent(
      memberId,
      user.activeGymId ?? user.gymId,
    );
  }

  @Get('member/:memberId/history')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  history(@Param('memberId') memberId: string, @CurrentUser() user: any) {
    return this.agreements.findHistory(
      memberId,
      user.activeGymId ?? user.gymId,
    );
  }

  @Post(':id/sign')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  sign(
    @Param('id') id: string,
    @Body() dto: SignAggregatorAgreementDto,
    @CurrentUser() user: any,
  ) {
    return this.agreements.sign(
      id,
      dto,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }

  @Post(':id/revoke')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeAggregatorAgreementDto,
    @CurrentUser() user: any,
  ) {
    return this.agreements.revoke(
      id,
      dto,
      user.activeGymId ?? user.gymId,
      user.id,
    );
  }
}
