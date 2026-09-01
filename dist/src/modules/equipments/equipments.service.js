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
exports.EquipmentsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let EquipmentsService = class EquipmentsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, userGymId) {
        const gymId = dto.gymId || userGymId;
        if (!gymId) {
            throw new common_1.NotFoundException('Academia nao informada');
        }
        const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
        if (!gym) {
            throw new common_1.NotFoundException('Academia nao encontrada');
        }
        return this.prisma.equipment.create({
            data: {
                gymId,
                name: dto.name,
                standardName: dto.standardName,
                type: dto.type,
                primaryMuscle: dto.primaryMuscle,
                secondaryMuscles: dto.secondaryMuscles,
                movementPattern: dto.movementPattern,
                difficulty: dto.difficulty,
                contraindications: dto.contraindications,
                videoUrl: dto.videoUrl,
            },
        });
    }
    async findAll(userGymId) {
        return this.prisma.equipment.findMany({
            where: {
                ...(userGymId ? { gymId: userGymId } : {}),
                active: true,
            },
            orderBy: { name: 'asc' },
        });
    }
    async findOne(id, userGymId) {
        const equipment = await this.prisma.equipment.findUnique({ where: { id } });
        if (!equipment) {
            throw new common_1.NotFoundException('Equipamento nao encontrado');
        }
        if (userGymId && equipment.gymId !== userGymId) {
            throw new common_1.NotFoundException('Equipamento nao encontrado');
        }
        return equipment;
    }
};
exports.EquipmentsService = EquipmentsService;
exports.EquipmentsService = EquipmentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], EquipmentsService);
//# sourceMappingURL=equipments.service.js.map