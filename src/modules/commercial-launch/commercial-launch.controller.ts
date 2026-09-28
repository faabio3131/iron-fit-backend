import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommercialLaunchService } from './commercial-launch.service';
import {
  AddCommercialLaunchOfferingDto,
  ApproveCommercialLaunchMatrixDto,
  CreateCommercialLaunchMatrixDto,
  SetCommercialLaunchPolicyDto,
  UpsertCommercialLaunchItemDto,
} from './dto/commercial-launch.dto';

@Controller('commercial-launch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class CommercialLaunchController {
  constructor(private readonly service: CommercialLaunchService) {}

  @Get('matrices')
  list() {
    return this.service.list();
  }

  @Get('current')
  current() {
    return this.service.currentApproved();
  }

  @Post('matrices')
  create(
    @Body() dto: CreateCommercialLaunchMatrixDto,
    @CurrentUser() user: any,
  ) {
    return this.service.create(dto, user.id);
  }

  @Put('matrices/:id/items')
  upsertItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertCommercialLaunchItemDto,
    @CurrentUser() user: any,
  ) {
    return this.service.upsertItem(id, dto, user.id);
  }

  @Delete('matrices/:id/items/:itemKey')
  removeItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemKey') itemKey: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeItem(id, itemKey, user.id);
  }

  @Post('matrices/:id/offerings')
  addOffering(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddCommercialLaunchOfferingDto,
    @CurrentUser() user: any,
  ) {
    return this.service.addOffering(id, dto, user.id);
  }

  @Delete('matrices/:id/offerings/:priceId')
  removeOffering(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('priceId', new ParseUUIDPipe()) priceId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeOffering(id, priceId, user.id);
  }

  @Put('matrices/:id/policy')
  setPolicy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetCommercialLaunchPolicyDto,
    @CurrentUser() user: any,
  ) {
    return this.service.setPolicy(id, dto, user.id);
  }

  @Post('matrices/:id/validate')
  validateDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.validateDraft(id);
  }

  @Post('matrices/:id/approve')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveCommercialLaunchMatrixDto,
    @CurrentUser() user: any,
  ) {
    return this.service.approve(id, user.id, dto);
  }
}
