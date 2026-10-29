import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EquipmentsService } from './equipments.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentOperationDto } from './dto/update-equipment-operation.dto';
import { EquipmentCatalogQueryDto } from './dto/equipment-catalog-query.dto';
import { SelectCatalogEquipmentDto } from './dto/select-catalog-equipment.dto';
import { SubmitEquipmentCatalogCandidateDto } from './dto/submit-equipment-catalog-candidate.dto';
import { EquipmentCatalogCandidateQueryDto } from './dto/equipment-catalog-candidate-query.dto';
import { ReviewEquipmentCatalogCandidateDto } from './dto/review-equipment-catalog-candidate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveTenantOperationGymId } from '../../common/security/tenant-operation-scope';

@Controller('equipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EquipmentsController {
  constructor(private equipmentsService: EquipmentsService) {}

  @Get('catalog')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findCatalog(
    @Query() query: EquipmentCatalogQueryDto,
    @CurrentUser() user: any,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: query.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.findCatalog(query, gymId);
  }

  @Get('catalog/candidates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findCatalogCandidates(
    @Query() query: EquipmentCatalogCandidateQueryDto,
    @CurrentUser() user: any,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: query.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.findCatalogCandidates(query, gymId);
  }

  @Post('catalog/candidates')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  submitCatalogCandidate(
    @Body() dto: SubmitEquipmentCatalogCandidateDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.submitCatalogCandidate(dto, gymId, user.id);
  }

  @Get('catalog/governance/candidates')
  @Roles('SUPER_ADMIN')
  findGovernanceCatalogCandidates(
    @Query() query: EquipmentCatalogCandidateQueryDto,
  ) {
    return this.equipmentsService.findGovernanceCatalogCandidates(query);
  }

  @Post('catalog/governance/candidates/:candidateId/review')
  @Roles('SUPER_ADMIN')
  reviewCatalogCandidate(
    @Param('candidateId', new ParseUUIDPipe()) candidateId: string,
    @Body() dto: ReviewEquipmentCatalogCandidateDto,
    @CurrentUser() user: any,
  ) {
    return this.equipmentsService.reviewCatalogCandidate(candidateId, dto, user.id);
  }

  @Get('exercises/:exerciseId/compatible')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findCompatibleForExercise(
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.findCompatibleForExercise(exerciseId, gymId);
  }

  @Post('catalog/selection')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  selectCatalog(
    @Body() dto: SelectCatalogEquipmentDto,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.selectCatalog(dto, gymId, user.id);
  }

  @Delete('catalog/:catalogItemId/selection')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  deselectCatalog(
    @Param('catalogItemId', new ParseUUIDPipe()) catalogItemId: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.deselectCatalog(catalogItemId, gymId, user.id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(@Body() dto: CreateEquipmentDto, @CurrentUser() user: any) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId: dto.gymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.create(dto, gymId);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findAll(@CurrentUser() user: any, @Query('gymId') requestedGymId?: string) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.findAll(gymId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('gymId') requestedGymId?: string,
  ) {
    const gymId = resolveTenantOperationGymId({
      activeGymId: user.activeGymId ?? user.gymId,
      requestedGymId,
      isSuperAdmin: user.isSuperAdmin === true,
    });
    return this.equipmentsService.findOne(id, gymId);
  }

  @Post(':id/operational-status')
  @Roles('OWNER', 'MANAGER')
  updateOperationalStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEquipmentOperationDto,
    @CurrentUser() user: any,
  ) {
    const gymId = resolveTenantOperationGymId({ activeGymId: user.activeGymId ?? user.gymId, isSuperAdmin: false });
    return this.equipmentsService.updateOperationalStatus(id, gymId, user.id, dto.status);
  }
}
