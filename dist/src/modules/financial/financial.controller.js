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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialController = void 0;
const common_1 = require("@nestjs/common");
const financial_service_1 = require("./financial.service");
const create_financial_account_dto_1 = require("./dto/create-financial-account.dto");
const create_subscription_dto_1 = require("./dto/create-subscription.dto");
const create_charge_dto_1 = require("./dto/create-charge.dto");
const pay_charge_dto_1 = require("./dto/pay-charge.dto");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
let FinancialController = class FinancialController {
    financialService;
    constructor(financialService) {
        this.financialService = financialService;
    }
    createAccount(dto, user) {
        return this.financialService.createAccount(dto, user.gymId);
    }
    findAllAccounts(user) {
        return this.financialService.findAllAccounts(user.gymId);
    }
    createSubscription(dto, user) {
        return this.financialService.createSubscription(dto, user.gymId);
    }
    createCharge(dto, user) {
        return this.financialService.createCharge(dto, user.gymId);
    }
    findAllCharges(user) {
        return this.financialService.findAllCharges(user.gymId);
    }
    payCharge(id, dto, user) {
        return this.financialService.payCharge(id, dto, user.gymId);
    }
};
exports.FinancialController = FinancialController;
__decorate([
    (0, common_1.Post)('accounts'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_financial_account_dto_1.CreateFinancialAccountDto, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "createAccount", null);
__decorate([
    (0, common_1.Get)('accounts'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "findAllAccounts", null);
__decorate([
    (0, common_1.Post)('subscriptions'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_subscription_dto_1.CreateSubscriptionDto, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "createSubscription", null);
__decorate([
    (0, common_1.Post)('charges'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_charge_dto_1.CreateChargeDto, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "createCharge", null);
__decorate([
    (0, common_1.Get)('charges'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "findAllCharges", null);
__decorate([
    (0, common_1.Patch)('charges/:id/pay'),
    (0, roles_decorator_1.Roles)('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, pay_charge_dto_1.PayChargeDto, Object]),
    __metadata("design:returntype", void 0)
], FinancialController.prototype, "payCharge", null);
exports.FinancialController = FinancialController = __decorate([
    (0, common_1.Controller)('financial'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [financial_service_1.FinancialService])
], FinancialController);
//# sourceMappingURL=financial.controller.js.map