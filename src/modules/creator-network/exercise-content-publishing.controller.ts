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
import {
  CreateExerciseContentMappingDto,
  UnpublishExerciseContentMappingDto,
} from './dto/exercise-content-publishing.dto';
import { ExerciseContentPublishingService } from './exercise-content-publishing.service';

@Controller('creator-network/exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExerciseContentPublishingController {
  constructor(private readonly service: ExerciseContentPublishingService) {}

  private context(scope: string, user: any): ContentCatalogContext {
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException('Mapping GLOBAL exige SUPER_ADMIN');
      }
      return { scope: CreatorRightsScope.GLOBAL, gymId: null };
    }

    if (scope === 'tenant') {
      if (!user.activeGymId || user.isSuperAdmin) {
        throw new ForbiddenException(
          'Mapping TENANT exige OWNER/MANAGER com tenant autenticado',
        );
      }
      return { scope: CreatorRightsScope.TENANT, gymId: user.activeGymId };
    }

    throw new ForbiddenException('Mapping scope invalido');
  }

  @Get(':scope/:exerciseId/content-mappings')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  listMappings(
    @Param('scope') scope: string,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.listMappings(this.context(scope, user), exerciseId);
  }

  @Post(':scope/:exerciseId/content-mappings')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  registerMapping(
    @Param('scope') scope: string,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Body() dto: CreateExerciseContentMappingDto,
    @CurrentUser() user: any,
  ) {
    return this.service.registerMapping(
      this.context(scope, user),
      exerciseId,
      dto,
      user.id,
    );
  }

  @Post(':scope/:exerciseId/content-mappings/:mappingId/publish')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  publishMapping(
    @Param('scope') scope: string,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Param('mappingId', new ParseUUIDPipe()) mappingId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.publishMapping(
      this.context(scope, user),
      exerciseId,
      mappingId,
      user.id,
    );
  }

  @Post(':scope/:exerciseId/content-mappings/:mappingId/unpublish')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  unpublishMapping(
    @Param('scope') scope: string,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Param('mappingId', new ParseUUIDPipe()) mappingId: string,
    @Body() dto: UnpublishExerciseContentMappingDto,
    @CurrentUser() user: any,
  ) {
    return this.service.unpublishMapping(
      this.context(scope, user),
      exerciseId,
      mappingId,
      dto.reason,
      user.id,
    );
  }

  @Get(':exerciseId/content-resolution')
  @Roles('OWNER', 'MANAGER', 'TRAINER', 'STUDENT')
  resolveExerciseContent(
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @CurrentUser() user: any,
  ) {
    if (!user.activeGymId || user.isSuperAdmin) {
      throw new ForbiddenException('Resolucao exige tenant autenticado');
    }
    return this.service.resolveExerciseContent(
      user.activeGymId,
      exerciseId,
      user.id,
      user.roles?.includes('STUDENT') === true,
    );
  }
}
