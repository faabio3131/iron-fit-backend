"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const health_controller_1 = require("./health.controller");
const auth_module_1 = require("./modules/auth/auth.module");
const gyms_module_1 = require("./modules/gyms/gyms.module");
const users_module_1 = require("./modules/users/users.module");
const students_module_1 = require("./modules/students/students.module");
const assessments_module_1 = require("./modules/assessments/assessments.module");
const equipments_module_1 = require("./modules/equipments/equipments.module");
const exercises_module_1 = require("./modules/exercises/exercises.module");
const workouts_module_1 = require("./modules/workouts/workouts.module");
const schedules_module_1 = require("./modules/schedules/schedules.module");
const access_module_1 = require("./modules/access/access.module");
const financial_module_1 = require("./modules/financial/financial.module");
const communication_module_1 = require("./modules/communication/communication.module");
const dashboard_module_1 = require("./modules/dashboard/dashboard.module");
const portal_module_1 = require("./modules/portal/portal.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            auth_module_1.AuthModule,
            gyms_module_1.GymsModule,
            users_module_1.UsersModule,
            students_module_1.StudentsModule,
            assessments_module_1.AssessmentsModule,
            equipments_module_1.EquipmentsModule,
            exercises_module_1.ExercisesModule,
            workouts_module_1.WorkoutsModule,
            schedules_module_1.SchedulesModule,
            access_module_1.AccessModule,
            financial_module_1.FinancialModule,
            communication_module_1.CommunicationModule,
            dashboard_module_1.DashboardModule,
            portal_module_1.PortalModule,
        ],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map