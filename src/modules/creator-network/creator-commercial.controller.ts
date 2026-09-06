import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreatorRightsScope } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreatorCommercialContext,
  CreatorCommercialService,
} from './creator-commercial.service';
import {
  AccrueUsageEventDto,
  CommercialRuleReasonDto,
  CreateCommercialRuleVersionDto,
  CreateCreatorSettlementDto,
  MarkCreatorSettlementSettledDto,
  RegisterCommercialAgreementDto,
} from './dto/creator-commercial.dto';

@Controller('creator-network/commercial')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreatorCommercialController {
  constructor(private readonly service: CreatorCommercialService) {}

  private context(scope: string, user: any): CreatorCommercialContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Commercial GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }
    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Commercial TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return { scope: CreatorRightsScope.TENANT, gymId: user.activeGymId };
    }
    throw new ForbiddenException('Commercial scope invalido');
  }

  @Post(':scope/agreements')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  registerAgreement(
    @Param('scope') scope: string,
    @Body() dto: RegisterCommercialAgreementDto,
    @CurrentUser() user: any,
  ) {
    return this.service.registerAgreement(this.context(scope, user), dto, user.id);
  }

  @Post(':scope/agreements/:agreementId/versions')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createRuleVersion(
    @Param('scope') scope: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
    @Body() dto: CreateCommercialRuleVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createRuleVersion(
      this.context(scope, user),
      agreementId,
      dto,
      user.id,
    );
  }

  @Post(':scope/agreements/:agreementId/versions/:ruleVersionId/activate')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  activateRuleVersion(
    @Param('scope') scope: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
    @Param('ruleVersionId', new ParseUUIDPipe()) ruleVersionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.activateRuleVersion(
      this.context(scope, user),
      agreementId,
      ruleVersionId,
      user.id,
    );
  }

  @Post(':scope/agreements/:agreementId/versions/:ruleVersionId/revoke')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  revokeRuleVersion(
    @Param('scope') scope: string,
    @Param('agreementId', new ParseUUIDPipe()) agreementId: string,
    @Param('ruleVersionId', new ParseUUIDPipe()) ruleVersionId: string,
    @Body() dto: CommercialRuleReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.revokeRuleVersion(
      this.context(scope, user),
      agreementId,
      ruleVersionId,
      dto,
      user.id,
    );
  }

  @Post(':scope/usage-events/:usageEventId/accrue')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  accrueUsageEvent(
    @Param('scope') scope: string,
    @Param('usageEventId', new ParseUUIDPipe()) usageEventId: string,
    @Body() dto: AccrueUsageEventDto,
    @CurrentUser() user: any,
  ) {
    return this.service.accrueUsageEvent(
      this.context(scope, user),
      usageEventId,
      dto,
      user.id,
    );
  }

  @Post(':scope/settlements')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  createSettlement(
    @Param('scope') scope: string,
    @Body() dto: CreateCreatorSettlementDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createSettlement(this.context(scope, user), dto, user.id);
  }

  @Post(':scope/settlements/:settlementId/settle')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  markSettlementSettled(
    @Param('scope') scope: string,
    @Param('settlementId', new ParseUUIDPipe()) settlementId: string,
    @Body() dto: MarkCreatorSettlementSettledDto,
    @CurrentUser() user: any,
  ) {
    return this.service.markSettlementSettled(
      this.context(scope, user),
      settlementId,
      dto,
      user.id,
    );
  }
}
