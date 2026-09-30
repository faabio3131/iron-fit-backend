import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { BookStudentDto } from './dto/book-student.dto';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async createSlot(dto: CreateScheduleSlotDto, gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, active: true },
    });

    if (!gym) {
      throw new NotFoundException('Academia nao encontrada');
    }

    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException(
        'Horario inicial deve ser anterior ao horario final',
      );
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

  async findAllSlots(gymId: string) {
    return this.prisma.scheduleSlot.findMany({
      where: {
        gymId,
        active: true,
      },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  }


  async findAllSchedules(
    gymId: string,
    filters: {
      from?: string;
      to?: string;
      status?: string;
      studentId?: string;
    } = {},
  ) {
    const allowedStatuses = new Set([
      'SCHEDULED',
      'CHECKED_IN',
      'NO_SHOW',
      'CANCELED',
    ]);
    if (filters.status && !allowedStatuses.has(filters.status)) {
      throw new BadRequestException('Status de agendamento invalido');
    }

    const parseBoundary = (value: string | undefined, label: string) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(
          `Data ${label} invalida para consulta da agenda`,
        );
      }
      return parsed;
    };

    const from = parseBoundary(filters.from, 'inicial');
    const to = parseBoundary(filters.to, 'final');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'Data inicial nao pode ser posterior a data final',
      );
    }

    const date =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    return this.prisma.studentSchedule.findMany({
      where: {
        student: { gymId },
        slot: { gymId },
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(date ? { date } : {}),
      },
      include: {
        student: { include: { user: true } },
        slot: true,
      },
      orderBy: { date: 'asc' },
      take: 500,
    });
  }

  async findByStudent(studentId: string, gymId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, gymId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException('Aluno nao encontrado');
    }

    return this.prisma.studentSchedule.findMany({
      where: {
        studentId,
        student: { gymId },
        slot: { gymId },
      },
      include: { slot: true },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async book(dto: BookStudentDto, gymId: string) {
    const bookingDate = new Date(dto.date);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const student = await tx.student.findFirst({
              where: { id: dto.studentId, gymId },
            });

            if (!student) {
              throw new NotFoundException('Aluno nao encontrado');
            }

            const slot = await tx.scheduleSlot.findFirst({
              where: { id: dto.slotId, gymId, active: true },
            });

            if (!slot) {
              throw new NotFoundException('Horario nao encontrado');
            }

            const calendarDate = new Date(`${dto.date.slice(0, 10)}T00:00:00.000Z`);
            if (calendarDate.getUTCDay() !== slot.weekday) {
              throw new BadRequestException(
                'Data escolhida nao corresponde ao dia da semana do horario',
              );
            }

            const existing = await tx.studentSchedule.findFirst({
              where: {
                studentId: dto.studentId,
                slotId: dto.slotId,
                date: bookingDate,
                status: { in: ['SCHEDULED', 'CHECKED_IN'] },
              } as any,
            });

            if (existing) {
              throw new BadRequestException('Aluno ja agendado neste horario');
            }

            const booked = await tx.studentSchedule.count({
              where: {
                slotId: dto.slotId,
                date: bookingDate,
                status: { in: ['SCHEDULED', 'CHECKED_IN'] },
              } as any,
            });

            if (booked >= slot.capacity) {
              throw new BadRequestException('Slot lotado');
            }

            return tx.studentSchedule.create({
              data: {
                studentId: dto.studentId,
                slotId: dto.slotId,
                date: bookingDate,
              } as any,
              include: {
                student: { include: { user: true } },
                slot: true,
              },
            });
          },
          { isolationLevel: 'Serializable' as any },
        );
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException('Nao foi possivel concluir o agendamento');
  }

  async checkIn(id: string, gymId: string) {
    const schedule = await this.prisma.studentSchedule.findFirst({
      where: {
        id,
        student: { gymId },
        slot: { gymId },
      },
      include: { slot: true, student: { include: { user: true } } },
    });

    if (!schedule) {
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
