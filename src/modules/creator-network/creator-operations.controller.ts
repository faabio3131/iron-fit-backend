import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreatorRightsScope } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreatorAnalyticsContext,
  CreatorAnalyticsService,
} from './creator-analytics.service';
import {
  CreatorOperationsConsoleService,
  CreatorOperationsContext,
} from './creator-operations-console.service';

type CreatorOperationsReadContext = CreatorAnalyticsContext &
  CreatorOperationsContext;

@Controller('creator-network/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class CreatorOperationsController {
  constructor(
    private readonly consoleService: CreatorOperationsConsoleService,
    private readonly analyticsService: CreatorAnalyticsService,
  ) {}

  private context(scope: string, user: any): CreatorOperationsReadContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Creator Operations GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }
    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Creator Operations TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return {
        scope: CreatorRightsScope.TENANT,
        gymId: user.activeGymId,
      };
    }
    throw new ForbiddenException('Creator Operations scope invalido');
  }

  @Get(':scope/overview')
  getOverview(@Param('scope') scope: string, @CurrentUser() user: any) {
    return this.consoleService.getOverview(this.context(scope, user));
  }

  @Get(':scope/analytics')
  getAnalytics(
    @Param('scope') scope: string,
    @Query('days') days: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.analyticsService.getAnalytics(
      this.context(scope, user),
      days,
    );
  }
}
