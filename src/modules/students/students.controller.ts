import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { AcceptStudentInviteDto } from './dto/accept-student-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private studentsService: StudentsService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')
  create(@Body() dto: CreateStudentDto, @CurrentUser() user: any) {
    return this.studentsService.create(
      dto,
      user.activeGymId ?? user.gymId,
    );
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER')
  findAll(@CurrentUser() user: any) {
    return this.studentsService.findAll(user.activeGymId ?? user.gymId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.studentsService.findOne(
      id,
      user.activeGymId ?? user.gymId,
    );
  }
}

@Controller('student-onboarding')
export class StudentOnboardingController {
  constructor(private studentsService: StudentsService) {}

  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptStudentInviteDto) {
    return this.studentsService.acceptInvite(dto);
  }
}
