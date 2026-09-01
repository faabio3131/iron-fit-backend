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
exports.WorkoutsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let WorkoutsService = class WorkoutsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: dto.studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        const sessions = dto.sessions || [];
        const workout = await this.prisma.workout.create({
            data: {
                studentId: dto.studentId,
                assessmentId: dto.assessmentId,
                goal: dto.goal,
                level: dto.level,
                weeklyFrequency: dto.weeklyFrequency,
                startDate: dto.startDate ? new Date(dto.startDate) : null,
                validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
                notes: dto.notes,
                status: 'DRAFT',
                sessions: {
                    create: sessions.map((s, si) => ({
                        name: s.name,
                        sessionType: s.sessionType,
                        order: s.order ?? si + 1,
                        estimatedMinutes: s.estimatedMinutes,
                        exercises: {
                            create: (s.exercises || []).map((e, ei) => ({
                                exerciseId: e.exerciseId,
                                equipmentId: e.equipmentId,
                                order: e.order ?? ei + 1,
                                sets: e.sets,
                                reps: e.reps,
                                restSeconds: e.restSeconds,
                                suggestedLoad: e.suggestedLoad,
                                notes: e.notes,
                            })),
                        },
                    })),
                },
            },
            include: {
                sessions: {
                    include: {
                        exercises: {
                            include: { exercise: true, equipment: true },
                        },
                    },
                },
            },
        });
        return workout;
    }
    async findAllByStudent(studentId, userGymId) {
        const student = await this.prisma.student.findFirst({
            where: {
                id: studentId,
                ...(userGymId ? { gymId: userGymId } : {}),
            },
        });
        if (!student) {
            throw new common_1.NotFoundException('Aluno nao encontrado');
        }
        return this.prisma.workout.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
            include: {
                sessions: {
                    include: {
                        exercises: { include: { exercise: true } },
                    },
                },
            },
        });
    }
    async findOne(id, userGymId) {
        const workout = await this.prisma.workout.findUnique({
            where: { id },
            include: {
                student: true,
                sessions: {
                    include: {
                        exercises: { include: { exercise: true, equipment: true } },
                    },
                },
            },
        });
        if (!workout) {
            throw new common_1.NotFoundException('Treino nao encontrado');
        }
        if (userGymId && workout.student.gymId !== userGymId) {
            throw new common_1.NotFoundException('Treino nao encontrado');
        }
        return workout;
    }
    async updateStatus(id, status, userId, userGymId) {
        const workout = await this.prisma.workout.findUnique({
            where: { id },
            include: { student: true },
        });
        if (!workout) {
            throw new common_1.NotFoundException('Treino nao encontrado');
        }
        if (userGymId && workout.student.gymId !== userGymId) {
            throw new common_1.NotFoundException('Treino nao encontrado');
        }
        const allowed = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED'];
        if (!allowed.includes(status)) {
            throw new common_1.BadRequestException('Status invalido');
        }
        const data = { status };
        if (status === 'APPROVED' || status === 'ACTIVE') {
            data.approvedById = userId;
        }
        return this.prisma.workout.update({ where: { id }, data });
    }
};
exports.WorkoutsService = WorkoutsService;
exports.WorkoutsService = WorkoutsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WorkoutsService);
//# sourceMappingURL=workouts.service.js.map