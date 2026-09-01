"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let SchedulesService = class SchedulesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createSlot(dto, userGymId) {
        const gymId = dto.gymId || userGymId;
        if (!gymId) {
            throw new common_1.NotFoundException('Academia nao informada');
        }
        return this.prisma.scheduleSlot.create({
            data: {
                gymId,
                weekday: dto.weekday,
                startTime: dto.startTime,
                endTime: dto.endTime,
                capacity: dto.capacity,
                active: dto.active ?? true,
            },
        });
    }
    async findAllSlots(userGymId) {
        return this.prisma.scheduleSlot.findMany({
            where: {
                ...(userGymId ? { gymId: userGymId } : {}),
                active: true,
            },
            orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        });
    }
    async book(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        const slot = await this.prisma.scheduleSlot.findUnique({
            where: { id: dto.slotId },
        });
        if (!slot) {
            throw new common_1.NotFoundException('Horario nao encontrado');
        }
        if (userGymId && slot.gymId !== userGymId) {
            throw new common_1.NotFoundException('Horario nao encontrado');
        }
        const booked = await this.prisma.studentSchedule.count({
            where: {
                slotId: dto.slotId,
                date: new Date(dto.date),
                status: { in: ['SCHEDULED', 'CHECKED_IN'] },
            },
        });
        if (booked >= slot.capacity) {
            throw new common_1.BadRequestException('Slot lotado');
        }
        return this.prisma.studentSchedule.create({
            data: {
                studentId: dto.studentId,
                slotId: dto.slotId,
                date: new Date(dto.date),
            },
            include: {
                student: { include: { user: true } },
                slot: true,
            },
        });
    }
    async checkIn(id, userGymId) {
        const schedule = await this.prisma.studentSchedule.findUnique({
            where: { id },
            include: { slot: true, student: { include: { user: true } } },
        });
        if (!schedule) {
            throw new common_1.NotFoundException('Agendamento nao encontrado');
        }
        if (userGymId && schedule.slot.gymId !== userGymId) {
            throw new common_1.NotFoundException('Agendamento nao encontrado');
        }
        if (schedule.status !== 'SCHEDULED') {
            throw new common_1.BadRequestException('Agendamento nao pode receber check-in');
        }
        return this.prisma.studentSchedule.update({
            where: { id },
            data: { status: 'CHECKED_IN', checkedInAt: new Date() },
            include: { student: { include: { user: true } }, slot: true },
        });
    }
};
exports.SchedulesService = SchedulesService;
exports.SchedulesService = SchedulesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SchedulesService);
//# sourceMappingURL=schedules.service.js.map