import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async createSlot(dto: CreateScheduleSlotDto, userGymId?: string) {
    const gymId = dto.gymId || userGymId;

    if (!gymId) {
      throw new NotFoundException('Academia nao informada');
    }

    return this.prisma.scheduleSlot.create({
      data: {
        gymId,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity,
        active: dto.active ?? true,
      } as any,
    });
  }

  async findAllSlots(userGymId?: string) {
    return this.prisma.scheduleSlot.findMany({
      where: {
        ...(userGymId ? { gymId: userGymId } : {}),
        active: true,
      },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  }

  async book(dto: BookStudentDto, userGymId?: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        ...(userGymId ? { gymId: userGymId } : {}),
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    const slot = await this.prisma.scheduleSlot.findUnique({
      where: { id: dto.slotId },
    });

    if (!slot) {
      throw new NotFoundException('Horario nao encontrado');
    }

    if (userGymId && slot.gymId !== userGymId) {
      throw new NotFoundException('Horario nao encontrado');
    }

    const booked = await this.prisma.studentSchedule.count({
      where: {
        slotId: dto.slotId,
        date: new Date(dto.date),
        status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      } as any,
    });

    if (booked >= slot.capacity) {
      throw new BadRequestException('Slot lotado');
    }

    return this.prisma.studentSchedule.create({
      data: {
        studentId: dto.studentId,
        slotId: dto.slotId,
        date: new Date(dto.date),
      } as any,
      include: {
        student: { include: { user: true } },
        slot: true,
      },
    });
  }

  async checkIn(id: string, userGymId?: string) {
    const schedule = await this.prisma.studentSchedule.findUnique({
      where: { id },
      include: { slot: true, student: { include: { user: true } } },
    });

    if (!schedule) {
      throw new NotFoundException('Agendamento nao encontrado');
    }

    if (userGymId && schedule.slot.gymId !== userGymId) {
      throw new NotFoundException('Agendamento nao encontrado');
    }

    if (schedule.status !== 'SCHEDULED') {
      throw new BadRequestException('Agendamento nao pode receber check-in');
    }

    return this.prisma.studentSchedule.update({
      where: { id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date() } as any,
      include: { student: { include: { user: true } }, slot: true },
    });
  }
}
