import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

@Injectable()
export class AssessmentsService {
  private readonly audit: AuditService;

  constructor(private prisma: PrismaService) {
    this.audit = new AuditService(prisma);
  }

  private requireGymId(userGymId?: string) {
    if (!userGymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return userGymId;
  }

  async create(dto: CreateAssessmentDto, userId: string, userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        gymId,
      },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    let calculatedBmi = dto.bmi;
    if (!calculatedBmi && dto.weight && dto.height) {
      const heightInMeters = dto.height / 100;
      calculatedBmi = Math.round((dto.weight / (heightInMeters * heightInMeters)) * 10) / 10;
    }

    const assessment = await this.prisma.assessment.create({
      data: {
        studentId: dto.studentId,
        evaluatorId: userId,
        weight: dto.weight,
        height: dto.height,
        bmi: calculatedBmi,
        bodyFatPercent: dto.bodyFatPercent,
        measurements: dto.measurements,
        restrictions: dto.restrictions,
        notes: dto.notes,
      } as any,
    });

    await this.audit.record({
      gymId,
      userId,
      action: 'ASSESSMENT_CREATED',
      entity: 'Assessment',
      entityId: assessment.id,
      next: {
        studentId: dto.studentId,
        bmi: assessment.bmi,
        bodyFatPercent: assessment.bodyFatPercent,
        restrictions: assessment.restrictions,
      },
    });

    const studentUser = student.user;

    return {
      id: assessment.id,
      studentName: studentUser ? studentUser.name : 'Sem usuario',
      studentEmail: studentUser ? studentUser.email : null,
      weight: assessment.weight,
      height: assessment.height,
      bmi: assessment.bmi,
      bodyFatPercent: assessment.bodyFatPercent,
      measurements: assessment.measurements,
      restrictions: assessment.restrictions,
      notes: assessment.notes,
      workoutCount: await this.prisma.workout.count({ where: { assessmentId: assessment.id } }),
      createdAt: assessment.createdAt,
    };
  }

  async findAllByStudent(studentId: string, userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        gymId,
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const assessments = await this.prisma.assessment.findMany({
      where: { studentId },
      include: {
        _count: { select: { workouts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return assessments.map((a) => ({
      id: a.id,
      weight: a.weight,
      height: a.height,
      bmi: a.bmi,
      bodyFatPercent: a.bodyFatPercent,
      measurements: a.measurements,
      restrictions: a.restrictions,
      notes: a.notes,
      workoutCount: a._count.workouts,
      createdAt: a.createdAt,
    }));
  }

  async findOne(id: string, userGymId?: string) {
    const gymId = this.requireGymId(userGymId);
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: {
        student: {
          include: { user: true },
        },
      },
    });

    if (!assessment || assessment.student.gymId !== gymId) {
      throw new NotFoundException('Avaliacao nao encontrada');
    }

    const studentUser = assessment.student.user;

    return {
      id: assessment.id,
      studentName: studentUser ? studentUser.name : 'Sem usuario',
      studentEmail: studentUser ? studentUser.email : null,
      weight: assessment.weight,
      height: assessment.height,
      bmi: assessment.bmi,
      bodyFatPercent: assessment.bodyFatPercent,
      measurements: assessment.measurements,
      restrictions: assessment.restrictions,
      notes: assessment.notes,
      workoutCount: await this.prisma.workout.count({ where: { assessmentId: assessment.id } }),
      createdAt: assessment.createdAt,
    };
  }
}
