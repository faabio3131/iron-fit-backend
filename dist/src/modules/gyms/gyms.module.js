"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GymsModule = void 0;
const common_1 = require("@nestjs/common");
const gyms_controller_1 = require("./gyms.controller");
const gyms_service_1 = require("./gyms.service");
const prisma_service_1 = require("../../prisma/prisma.service");
let GymsModule = class GymsModule {
};
exports.GymsModule = GymsModule;
exports.GymsModule = GymsModule = __decorate([
    (0, common_1.Module)({
        controllers: [gyms_controller_1.GymsController],
        providers: [gyms_service_1.GymsService, prisma_service_1.PrismaService],
        exports: [gyms_service_1.GymsService],
    })
], GymsModule);
//# sourceMappingURL=gyms.module.js.map