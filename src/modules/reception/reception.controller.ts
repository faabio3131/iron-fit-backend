import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { ReceptionService } from './reception.service';
import { DeskEnrollDto, DeskPlanDto, DeskPlanStatusDto, DeskPolicyDto, DeskReceiveDto } from './dto/reception.dto';

@Controller('reception')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'RECEPTION')
export class ReceptionController {
  constructor(private readonly desk: ReceptionService) {}
  @Get('catalog') catalog(@CurrentUser() user: any) { return this.desk.catalog(user.activeGymId, user.id); }
  @Post('enroll') enroll(@CurrentUser() user: any, @Body() dto: DeskEnrollDto) { return this.desk.enroll(user.activeGymId, user.id, dto); }
  @Get('students/:id/charges') charges(@CurrentUser() user: any, @Param('id') id: string) { return this.desk.studentCharges(user.activeGymId, user.id, id); }
  @Post('charges/:id/receive') receive(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: DeskReceiveDto) { return this.desk.receive(user.activeGymId, user.id, id, dto); }
  @Get('closing') closing(@CurrentUser() user: any, @Query('from') from: string, @Query('to') to: string) { return this.desk.closing(user.activeGymId, user.id, from, to); }
  @Get('admin/settings') @Roles('OWNER') @UseGuards(StepUpGuard)
  settings(@CurrentUser() user: any) { return this.desk.settings(user.activeGymId, user.id); }
  @Post('admin/policy') @Roles('OWNER') @UseGuards(StepUpGuard)
  configure(@CurrentUser() user: any, @Body() dto: DeskPolicyDto) { return this.desk.configure(user.activeGymId, user.id, dto); }
  @Post('admin/plans') @Roles('OWNER') @UseGuards(StepUpGuard)
  plan(@CurrentUser() user: any, @Body() dto: DeskPlanDto) { return this.desk.createPlan(user.activeGymId, user.id, dto); }
  @Patch('admin/plans/:id') @Roles('OWNER') @UseGuards(StepUpGuard)
  status(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: DeskPlanStatusDto) { return this.desk.setPlanActive(user.activeGymId, user.id, id, dto.active); }
}
