import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExercisesController {
  constructor(private exercisesService: ExercisesService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER')
  create(@Body() dto: CreateExerciseDto) {
    return this.exercisesService.create(dto);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'RECEPTION')
  findAll() {
    return this.exercisesService.findAll();
  }
}
