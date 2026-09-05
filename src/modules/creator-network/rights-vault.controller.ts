import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
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
  CreateRightsConsentDto,
  CreateRightsGrantDto,
  CreateRightsGrantVersionDto,
  CreateRightsHolderDto,
  RightsReasonDto,
} from './dto/rights-vault.dto';
import { RightsVaultContext, RightsVaultService } from './rights-vault.service';

@Controller('creator-network/rights')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class RightsVaultController {
  constructor(private readonly service: RightsVaultService) {}

  private context(scope: string, user: any): RightsVaultContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Rights Vault GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }

    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Rights Vault TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return {
        scope: CreatorRightsScope.TENANT,
        gymId: user.activeGymId,
      };
    }

    throw new ForbiddenException('Rights Vault scope invalido');
  }

  @Get(':scope/holders')
  findHolders(@Param('scope') scope: string, @CurrentUser() user: any) {
    return this.service.findHolders(this.context(scope, user));
  }

  @Post(':scope/holders')
  createHolder(
    @Param('scope') scope: string,
    @Body() dto: CreateRightsHolderDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createHolder(this.context(scope, user), dto, user.id);
  }

  @Post(':scope/holders/:holderId/retire')
  retireHolder(
    @Param('scope') scope: string,
    @Param('holderId', new ParseUUIDPipe()) holderId: string,
    @Body() dto: RightsReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.retireHolder(
      this.context(scope, user),
      holderId,
      dto.reason,
      user.id,
    );
  }

  @Get(':scope/grants')
  findGrants(@Param('scope') scope: string, @CurrentUser() user: any) {
    return this.service.findGrants(this.context(scope, user));
  }

  @Get(':scope/grants/:grantId')
  findGrant(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.findGrant(this.context(scope, user), grantId);
  }

  @Get(':scope/grants/:grantId/effective')
  evaluateGrant(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.evaluateGrant(this.context(scope, user), grantId);
  }

  @Post(':scope/grants')
  createGrant(
    @Param('scope') scope: string,
    @Body() dto: CreateRightsGrantDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createGrant(this.context(scope, user), dto, user.id);
  }

  @Post(':scope/grants/:grantId/versions')
  createGrantVersion(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Body() dto: CreateRightsGrantVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createGrantVersion(
      this.context(scope, user),
      grantId,
      dto,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/activate')
  activateGrantVersion(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: any,
  ) {
    return this.service.activateGrantVersion(
      this.context(scope, user),
      grantId,
      version,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/suspend')
  suspendGrantVersion(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: RightsReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.suspendGrantVersion(
      this.context(scope, user),
      grantId,
      version,
      dto.reason,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/resume')
  resumeGrantVersion(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: any,
  ) {
    return this.service.resumeGrantVersion(
      this.context(scope, user),
      grantId,
      version,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/revoke')
  revokeGrantVersion(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: RightsReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.revokeGrantVersion(
      this.context(scope, user),
      grantId,
      version,
      dto.reason,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/consents')
  addConsent(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: CreateRightsConsentDto,
    @CurrentUser() user: any,
  ) {
    return this.service.addConsent(
      this.context(scope, user),
      grantId,
      version,
      dto,
      user.id,
    );
  }

  @Post(':scope/grants/:grantId/versions/:version/consents/:consentId/revoke')
  revokeConsent(
    @Param('scope') scope: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('version', ParseIntPipe) version: number,
    @Param('consentId', new ParseUUIDPipe()) consentId: string,
    @Body() dto: RightsReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.revokeConsent(
      this.context(scope, user),
      grantId,
      version,
      consentId,
      dto.reason,
      user.id,
    );
  }
}
