import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStudentDto, userGymId?: string) {
    if (userGymId && dto.gymId !== userGymId) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const gym = await this.prisma.gym.findUnique({
      where: { id: dto.gymId },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    const existing = await this.prisma.student.findFirst({
      where: {
        gymId: dto.gymId,
        user: { email: dto.email },
      },
      include: { user: true },
    });

    if (existing) {
      throw new ConflictException('Aluno ja cadastrado nesta academia');
    }

    const passwordHash = await bcrypt.hash('aluno123', 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        passwordHash,
      },
    });

    const student = await this.prisma.student.create({
      data: {
        gymId: dto.gymId,
        userId: user.id,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        gender: dto.gender,
        goal: dto.goal,
        level: dto.level,
        consentHealth: dto.consentHealth || false,
        consentComm: dto.consentComm || false,
        consentBiometry: dto.consentBiometry || false,
      },
      include: { user: true },
    });

    return {
      id: student.id,
      name: student.user!.name,
      email: student.user!.email,
      phone: student.user!.phone,
      status: student.status,
      enrollmentDate: student.enrollmentDate,
    };
  }

  async findAll(gymId: string) {
    const students = await this.prisma.student.findMany({
      where: { gymId },
      include: { user: true },
      orderBy: { enrollmentDate: 'desc' },
    });

    return students.map((s) => ({
      id: s.id,
      name: s.user!.name,
      email: s.user!.email,
      phone: s.user!.phone,
      status: s.status,
      enrollmentDate: s.enrollmentDate,
    }));
  }

  async findOne(id: string, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, gymId },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return {
      id: student.id,
      name: student.user!.name,
      email: student.user!.email,
      phone: student.user!.phone,
      birthDate: student.birthDate,
      gender: student.gender,
      goal: student.goal,
      level: student.level,
      status: student.status,
      enrollmentDate: student.enrollmentDate,
      consentHealth: student.consentHealth,
      consentComm: student.consentComm,
      consentBiometry: student.consentBiometry,
    };
  }
}
