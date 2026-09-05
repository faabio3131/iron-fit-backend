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
import {
  CreateCanonicalContentDto,
  RegisterMediaAssetDto,
} from './dto/content-catalog.dto';
import {
  ContentCatalogContext,
  ContentCatalogService,
} from './content-catalog.service';

@Controller('creator-network/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class ContentCatalogController {
  constructor(private readonly service: ContentCatalogService) {}

  private context(scope: string, user: any): ContentCatalogContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Content Catalog GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }

    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Content Catalog TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return {
        scope: CreatorRightsScope.TENANT,
        gymId: user.activeGymId,
      };
    }

    throw new ForbiddenException('Content Catalog scope invalido');
  }

  @Get(':scope/items')
  findAll(@Param('scope') scope: string, @CurrentUser() user: any) {
    return this.service.findAll(this.context(scope, user));
  }

  @Get(':scope/items/:contentId')
  findOne(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.findOne(this.context(scope, user), contentId);
  }

  @Post(':scope/items')
  create(
    @Param('scope') scope: string,
    @Body() dto: CreateCanonicalContentDto,
    @CurrentUser() user: any,
  ) {
    return this.service.create(this.context(scope, user), dto, user.id);
  }

  @Post(':scope/items/:contentId/assets')
  registerMediaAsset(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Body() dto: RegisterMediaAssetDto,
    @CurrentUser() user: any,
  ) {
    return this.service.registerMediaAsset(
      this.context(scope, user),
      contentId,
      dto,
      user.id,
    );
  }
}
