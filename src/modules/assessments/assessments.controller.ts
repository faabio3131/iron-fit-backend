import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('students/:studentId/assessments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssessmentsController {
  constructor(private assessmentsService: AssessmentsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(
    @Param('studentId') studentId: string,
    @Body() dto: CreateAssessmentDto,
    @CurrentUser() user: any,
  ) {
    return this.assessmentsService.create(
      { ...dto, studentId },
      user.id,
      user.gymId,
    );
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findAllByStudent(@Param('studentId') studentId: string, @CurrentUser() user: any) {
    return this.assessmentsService.findAllByStudent(studentId, user.gymId);
  }
}

@Controller('assessments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssessmentsByIdController {
  constructor(private assessmentsService: AssessmentsService) {}

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.assessmentsService.findOne(id, user.gymId);
  }
}
