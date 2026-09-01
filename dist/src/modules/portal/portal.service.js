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
exports.PortalService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let PortalService = class PortalService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getStudentByUserId(userId) {
        const student = await this.prisma.student.findFirst({
            where: { userId },
            include: { gym: true, user: true },
        });
        if (!student) {
            throw new common_1.NotFoundException('Perfil de aluno nao encontrado para este usuario');
        }
        return student;
    }
    async getProfile(userId) {
        const s = await this.getStudentByUserId(userId);
        return {
            id: s.id,
            name: s.user ? s.user.name : null,
            email: s.user ? s.user.email : null,
            phone: s.user ? s.user.phone : null,
            gym: { id: s.gym.id, name: s.gym.name, slug: s.gym.slug, logoUrl: s.gym.logoUrl },
            status: s.status,
            enrollmentDate: s.enrollmentDate,
            goal: s.goal,
            level: s.level,
        };
    }
    async getWorkouts(userId) {
        const s = await this.getStudentByUserId(userId);
        return this.prisma.workout.findMany({
            where: { studentId: s.id, status: { in: ['APPROVED', 'ACTIVE'] } },
            orderBy: { createdAt: 'desc' },
            include: {
                sessions: {
                    orderBy: { order: 'asc' },
                    include: {
                        exercises: {
                            orderBy: { order: 'asc' },
                            include: { exercise: true, equipment: true },
                        },
                    },
                },
            },
        });
    }
    async getAssessments(userId) {
        const s = await this.getStudentByUserId(userId);
        return this.prisma.assessment.findMany({
            where: { studentId: s.id },
            orderBy: { createdAt: 'desc' },
        });
    }
    async getSchedules(userId) {
        const s = await this.getStudentByUserId(userId);
        return this.prisma.studentSchedule.findMany({
            where: { studentId: s.id },
            orderBy: { date: 'desc' },
            take: 30,
            include: { slot: true },
        });
    }
    async getCharges(userId) {
        const s = await this.getStudentByUserId(userId);
        return this.prisma.charge.findMany({
            where: { studentId: s.id },
            orderBy: { dueDate: 'desc' },
            take: 30,
        });
    }
    async checkIn(userId) {
        const s = await this.getStudentByUserId(userId);
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const booking = await this.prisma.studentSchedule.findFirst({
            where: {
                studentId: s.id,
                status: 'SCHEDULED',
                date: { gte: startOfDay, lte: endOfDay },
            },
            include: { slot: true },
        });
        if (!booking) {
            throw new common_1.BadRequestException('Nenhum agendamento para hoje');
        }
        return this.prisma.studentSchedule.update({
            where: { id: booking.id },
            data: { status: 'CHECKED_IN', checkedInAt: new Date() },
            include: { slot: true },
        });
    }
};
exports.PortalService = PortalService;
exports.PortalService = PortalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PortalService);
//# sourceMappingURL=portal.service.js.map