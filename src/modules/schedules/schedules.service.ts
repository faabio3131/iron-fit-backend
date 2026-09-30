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
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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
