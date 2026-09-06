import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { ContentCatalogContext } from './content-catalog.service';
import { ContentLifecycleService } from './content-lifecycle.service';
import {
  ContentLifecycleReasonDto,
  CreateContentVersionDto,
  ReviewContentVersionDto,
} from './dto/content-lifecycle.dto';

@Controller('creator-network/content-lifecycle')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class ContentLifecycleController {
  constructor(private readonly service: ContentLifecycleService) {}

  private context(scope: string, user: any): ContentCatalogContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Lifecycle GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }

    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Lifecycle TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return { scope: CreatorRightsScope.TENANT, gymId: user.activeGymId };
    }

    throw new ForbiddenException('Lifecycle scope invalido');
  }

  @Get(':scope/items/:contentId')
  findOne(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.findOne(this.context(scope, user), contentId);
  }

  @Post(':scope/items/:contentId/versions')
  createVersion(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Body() dto: CreateContentVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.createVersion(
      this.context(scope, user),
      contentId,
      dto,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/versions/:versionId/review')
  reviewVersion(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() dto: ReviewContentVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.reviewVersion(
      this.context(scope, user),
      contentId,
      versionId,
      dto,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/activate')
  activate(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.activate(
      this.context(scope, user),
      contentId,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/suspend')
  suspend(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Body() dto: ContentLifecycleReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.suspend(
      this.context(scope, user),
      contentId,
      dto,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/reactivate')
  reactivate(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.reactivate(
      this.context(scope, user),
      contentId,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/retire')
  retire(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Body() dto: ContentLifecycleReasonDto,
    @CurrentUser() user: any,
  ) {
    return this.service.retire(
      this.context(scope, user),
      contentId,
      dto,
      user.id,
    );
  }
}
