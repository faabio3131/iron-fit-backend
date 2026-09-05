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
import { PrepareMediaIngestionDto } from './dto/media-ingestion.dto';
import { MediaIngestionService } from './media-ingestion.service';

@Controller('creator-network/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
export class MediaIngestionController {
  constructor(private readonly service: MediaIngestionService) {}

  private context(scope: string, user: any): ContentCatalogContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Media GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }

    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Media TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return { scope: CreatorRightsScope.TENANT, gymId: user.activeGymId };
    }

    throw new ForbiddenException('Media scope invalido');
  }

  @Post(':scope/items/:contentId/assets/:assetId/ingestions')
  prepareIngestion(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Body() dto: PrepareMediaIngestionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.prepareIngestion(
      this.context(scope, user),
      contentId,
      assetId,
      dto,
      user.id,
    );
  }

  @Post(':scope/items/:contentId/assets/:assetId/ingestions/:ingestionId/verify')
  verifyIngestion(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Param('ingestionId', new ParseUUIDPipe()) ingestionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.verifyIngestion(
      this.context(scope, user),
      contentId,
      assetId,
      ingestionId,
      user.id,
    );
  }

  @Get(':scope/items/:contentId/assets/:assetId/delivery')
  resolveDelivery(
    @Param('scope') scope: string,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.resolveDelivery(
      this.context(scope, user),
      contentId,
      assetId,
    );
  }
}
