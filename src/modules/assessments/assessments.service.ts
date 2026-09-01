import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

@Injectable()
export class AssessmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAssessmentDto, userId: string, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    // Calcular IMC automaticamente se peso e altura foram informados
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
      } as any, // Cast para resolver rigidez de tipos do Prisma v6
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
      createdAt: assessment.createdAt,
    };
  }

  async findAllByStudent(studentId: string, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const assessments = await this.prisma.assessment.findMany({
      where: { studentId },
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
      createdAt: a.createdAt,
    }));
  }

  async findOne(id: string, userGymId?: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: {
        student: {
          include: { user: true },
        },
      },
    });

    if (!assessment) {
      throw new NotFoundException('Avaliacao nao encontrada');
    }

    if (userGymId && assessment.student.gymId !== userGymId) {
      throw new ForbiddenException('Sem acesso a esta avaliacao');
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
      createdAt: assessment.createdAt,
    };
  }
}
