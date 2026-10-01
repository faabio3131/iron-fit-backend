import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AcceptLegalDocumentDto,
  CancelDataSubjectRequestDto,
  CreateDataSubjectRequestDto,
  ReviewDataSubjectRequestDto,
  UpdateMyPrivacyConsentsDto,
} from './dto/privacy-governance.dto';
import { PrivacyGovernanceService } from './privacy-governance.service';

@Controller('privacy')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrivacyGovernanceController {
  constructor(
    private readonly privacy: PrivacyGovernanceService,
  ) {}

  @Post('dsr')
  createRequest(
    @CurrentUser() user: any,
    @Body() dto: CreateDataSubjectRequestDto,
  ) {
    return this.privacy.createRequest(user.id, dto);
  }

  @Get('dsr')
  listMine(@CurrentUser() user: any) {
    return this.privacy.listMine(user.id);
  }

  @Post('dsr/cancel')
  cancelMine(
    @CurrentUser() user: any,
    @Body() dto: CancelDataSubjectRequestDto,
  ) {
    return this.privacy.cancelMine(user.id, dto.requestId);
  }

  @Get('consents')
  getMyConsents(@CurrentUser() user: any) {
    return this.privacy.getMyConsents(user.id);
  }

  @Patch('consents')
  updateMyConsents(
    @CurrentUser() user: any,
    @Body() dto: UpdateMyPrivacyConsentsDto,
  ) {
    return this.privacy.updateMyConsents(user.id, dto);
  }

  @Get('legal-documents')
  listLegalDocuments() {
    return this.privacy.listLegalDocuments();
  }

  @Post('legal-acceptances')
  acceptLegalDocument(
    @CurrentUser() user: any,
    @Body() dto: AcceptLegalDocumentDto,
  ) {
    return this.privacy.acceptLegalDocument(user.id, dto);
  }

  @Get('legal-acceptances')
  listMyAcceptances(@CurrentUser() user: any) {
    return this.privacy.listMyAcceptances(user.id);
  }

  @Get('operations/dsr')
  @Roles('SUPER_ADMIN')
  listRequestsForOperations() {
    return this.privacy.listRequestsForOperations();
  }

  @Post('operations/dsr/:id/review')
  @Roles('SUPER_ADMIN')
  reviewRequest(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ReviewDataSubjectRequestDto,
  ) {
    return this.privacy.reviewRequest(id, user.id, dto);
  }

  @Get('operations/governance')
  @Roles('SUPER_ADMIN')
  governanceSnapshot() {
    return this.privacy.governanceSnapshot();
  }
}
