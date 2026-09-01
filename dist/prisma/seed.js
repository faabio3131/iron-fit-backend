"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Iniciando seed de permissoes e usuario inicial...');
    const roles = [
        { name: 'SUPER_ADMIN', description: 'Administrador global do sistema' },
        { name: 'OWNER', description: 'Proprietario da academia' },
        { name: 'MANAGER', description: 'Gerente da academia' },
        { name: 'RECEPTION', description: 'Recepcionista' },
        { name: 'TRAINER', description: 'Professor/Personal' },
        { name: 'STUDENT', description: 'Aluno' },
    ];
    for (const role of roles) {
        await prisma.role.upsert({
            where: { name: role.name },
            update: {},
            create: role,
        });
    }
    const permissions = [
        { name: 'auth:login', module: 'auth' },
        { name: 'users:read', module: 'users' },
        { name: 'users:write', module: 'users' },
        { name: 'users:delete', module: 'users' },
        { name: 'tenants:read', module: 'tenants' },
        { name: 'tenants:write', module: 'tenants' },
        { name: 'tenants:delete', module: 'tenants' },
        { name: 'roles:read', module: 'roles' },
        { name: 'roles:write', module: 'roles' },
        { name: 'students:read', module: 'students' },
        { name: 'students:write', module: 'students' },
        { name: 'students:delete', module: 'students' },
        { name: 'assessments:read', module: 'assessments' },
        { name: 'assessments:write', module: 'assessments' },
        { name: 'equipments:read', module: 'equipments' },
        { name: 'equipments:write', module: 'equipments' },
        { name: 'workouts:read', module: 'workouts' },
        { name: 'workouts:write', module: 'workouts' },
        { name: 'workouts:approve', module: 'workouts' },
        { name: 'ai:generate', module: 'ai' },
        { name: 'schedules:read', module: 'schedules' },
        { name: 'schedules:write', module: 'schedules' },
        { name: 'access:read', module: 'access' },
        { name: 'access:write', module: 'access' },
        { name: 'billing:read', module: 'billing' },
        { name: 'billing:write', module: 'billing' },
        { name: 'financial:read', module: 'financial' },
        { name: 'financial:write', module: 'financial' },
        { name: 'financial:delete', module: 'financial' },
        { name: 'communication:read', module: 'communication' },
        { name: 'communication:write', module: 'communication' },
        { name: 'communication:send', module: 'communication' },
        { name: 'audit:read', module: 'audit' },
    ];
    for (const perm of permissions) {
        await prisma.permission.upsert({
            where: { name: perm.name },
            update: {},
            create: perm,
        });
    }
    const superAdminRole = await prisma.role.findUnique({
        where: { name: 'SUPER_ADMIN' },
    });
    const allPermissions = await prisma.permission.findMany();
    for (const perm of allPermissions) {
        await prisma.rolePermission.upsert({
            where: {
                roleId_permissionId: {
                    roleId: superAdminRole.id,
                    permissionId: perm.id,
                },
            },
            update: {},
            create: {
                roleId: superAdminRole.id,
                permissionId: perm.id,
            },
        });
    }
    const passwordHash = await bcrypt.hash('admin123', 10);
    const superAdminUser = await prisma.user.upsert({
        where: { email: 'admin@gym-saas.com' },
        update: {},
        create: {
            email: 'admin@gym-saas.com',
            name: 'Super Admin',
            passwordHash,
            mfaEnabled: false,
        },
    });
    const existing = await prisma.userRole.findFirst({
        where: { userId: superAdminUser.id, roleId: superAdminRole.id },
    });
    if (!existing) {
        await prisma.userRole.create({
            data: { userId: superAdminUser.id, roleId: superAdminRole.id },
        });
    }
    console.log('Seed completo!');
    console.log('   - 6 roles criados');
    console.log(`   - ${allPermissions.length} permissoes criadas`);
    console.log('   - Super Admin: admin@gym-saas.com / admin123');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map