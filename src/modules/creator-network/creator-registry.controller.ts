import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatorRegistryService } from './creator-registry.service';
import { ChangeCreatorStatusDto } from './dto/change-creator-status.dto';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreateCreatorIdentityDto } from './dto/create-creator-identity.dto';
import { RevokeCreatorIdentityDto } from './dto/revoke-creator-identity.dto';

@Controller('creator-network')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreatorRegistryController {
  constructor(private readonly service: CreatorRegistryService) {}

  @Get('creators')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findAll() {
    return this.service.findAll();
  }

  @Get('creators/:creatorId')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  findOne(@Param('creatorId', new ParseUUIDPipe()) creatorId: string) {
    return this.service.findOne(creatorId);
  }

  @Post('creators')
  @Roles('SUPER_ADMIN')
  createCreator(@Body() dto: CreateCreatorDto, @CurrentUser() user: any) {
    return this.service.createCreator(dto, user.id);
  }

  @Post('creators/:creatorId/status')
  @Roles('SUPER_ADMIN')
  changeStatus(
    @Param('creatorId', new ParseUUIDPipe()) creatorId: string,
    @Body() dto: ChangeCreatorStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.service.changeStatus(creatorId, dto, user.id);
  }

  @Post('creators/:creatorId/identities')
  @Roles('SUPER_ADMIN')
  addIdentity(
    @Param('creatorId', new ParseUUIDPipe()) creatorId: string,
    @Body() dto: CreateCreatorIdentityDto,
    @CurrentUser() user: any,
  ) {
    return this.service.addIdentity(creatorId, dto, user.id);
  }

  @Post('creators/:creatorId/identities/:identityId/verify')
  @Roles('SUPER_ADMIN')
  verifyIdentity(
    @Param('creatorId', new ParseUUIDPipe()) creatorId: string,
    @Param('identityId', new ParseUUIDPipe()) identityId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.verifyIdentity(creatorId, identityId, user.id);
  }

  @Post('creators/:creatorId/identities/:identityId/revoke')
  @Roles('SUPER_ADMIN')
  revokeIdentity(
    @Param('creatorId', new ParseUUIDPipe()) creatorId: string,
    @Param('identityId', new ParseUUIDPipe()) identityId: string,
    @Body() dto: RevokeCreatorIdentityDto,
    @CurrentUser() user: any,
  ) {
    return this.service.revokeIdentity(creatorId, identityId, dto, user.id);
  }
}
