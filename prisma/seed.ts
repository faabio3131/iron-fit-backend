import { PrismaClient, RoleName } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed IronCloud...');

  // ---- ROLES ----
  const roles: { name: RoleName; description: string }[] = [
    { name: 'SUPER_ADMIN', description: 'Administrador global do sistema' },
    { name: 'OWNER', description: 'Proprietario da academia' },
    { name: 'MANAGER', description: 'Gerente da academia' },
    { name: 'RECEPTION', description: 'Recepcionista' },
    { name: 'TRAINER', description: 'Professor/Personal' },
    { name: 'STUDENT', description: 'Aluno' },
  ];
  for (const role of roles) {
    await prisma.role.upsert({ where: { name: role.name }, update: {}, create: role });
  }

  // ---- PERMISSIONS ----
  const permissions: { name: string; module: string }[] = [
    { name: 'auth:login', module: 'auth' }, { name: 'users:read', module: 'users' },
    { name: 'users:write', module: 'users' }, { name: 'users:delete', module: 'users' },
    { name: 'tenants:read', module: 'tenants' }, { name: 'tenants:write', module: 'tenants' },
    { name: 'tenants:delete', module: 'tenants' }, { name: 'roles:read', module: 'roles' },
    { name: 'roles:write', module: 'roles' }, { name: 'students:read', module: 'students' },
    { name: 'students:write', module: 'students' }, { name: 'students:delete', module: 'students' },
    { name: 'assessments:read', module: 'assessments' }, { name: 'assessments:write', module: 'assessments' },
    { name: 'equipments:read', module: 'equipments' }, { name: 'equipments:write', module: 'equipments' },
    { name: 'workouts:read', module: 'workouts' }, { name: 'workouts:write', module: 'workouts' },
    { name: 'workouts:approve', module: 'workouts' }, { name: 'ai:generate', module: 'ai' },
    { name: 'schedules:read', module: 'schedules' }, { name: 'schedules:write', module: 'schedules' },
    { name: 'access:read', module: 'access' }, { name: 'access:write', module: 'access' },
    { name: 'billing:read', module: 'billing' }, { name: 'billing:write', module: 'billing' },
    { name: 'financial:read', module: 'financial' }, { name: 'financial:write', module: 'financial' },
    { name: 'financial:delete', module: 'financial' }, { name: 'communication:read', module: 'communication' },
    { name: 'communication:write', module: 'communication' }, { name: 'communication:send', module: 'communication' },
    { name: 'audit:read', module: 'audit' },
  ];
  for (const perm of permissions) {
    await prisma.permission.upsert({ where: { name: perm.name }, update: {}, create: perm });
  }

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  const ownerRole = await prisma.role.findUnique({ where: { name: 'OWNER' } });
  const studentRole = await prisma.role.findUnique({ where: { name: 'STUDENT' } });
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole!.id, permissionId: perm.id } },
      update: {},
      create: { roleId: superAdminRole!.id, permissionId: perm.id },
    });
  }

  const adminHash = await bcrypt.hash('admin123', 10);
  const userHash = await bcrypt.hash('aluno123', 10);

  // ---- SUPER ADMIN ----
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'admin@gym-saas.com' },
    update: {},
    create: { email: 'admin@gym-saas.com', name: 'Super Admin', passwordHash: adminHash, mfaEnabled: false },
  });
  const saLink = await prisma.userRole.findFirst({ where: { userId: superAdminUser.id, roleId: superAdminRole!.id } });
  if (!saLink) await prisma.userRole.create({ data: { userId: superAdminUser.id, roleId: superAdminRole!.id } });

  // ---- ACADEMIA ----
  const gym = await prisma.gym.upsert({
    where: { slug: 'ironcloud-gym' },
    update: {},
    create: { name: 'IronCloud Gym', slug: 'ironcloud-gym', timezone: 'America/Sao_Paulo' },
  });

  // ---- DONO ----
  const ownerUser = await prisma.user.upsert({
    where: { email: 'dono@ironcloud.com' },
    update: {},
    create: { email: 'dono@ironcloud.com', name: 'Dono IronCloud', passwordHash: adminHash, mfaEnabled: false },
  });
  await prisma.userRole.upsert({
    where: { id: (await prisma.userRole.findFirst({ where: { userId: ownerUser.id, roleId: ownerRole!.id, gymId: gym.id } }))?.id ?? 'noop' },
    update: {},
    create: { userId: ownerUser.id, roleId: ownerRole!.id, gymId: gym.id },
  });

  // ---- ALUNOS ----
  const alunosDef = [
    { email: 'ana.souza@email.com', name: 'Ana Souza', goal: 'HIPERTROFIA', level: 'INTERMEDIARIO' },
    { email: 'bruno.lima@email.com', name: 'Bruno Lima', goal: 'EMAGRECIMENTO', level: 'INICIANTE' },
    { email: 'carla.dias@email.com', name: 'Carla Dias', goal: 'CONDICIONAMENTO', level: 'AVANCADO' },
  ];
  const students: { id: string }[] = [];
  for (const a of alunosDef) {
    const u = await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: { email: a.email, name: a.name, passwordHash: userHash, mfaEnabled: false },
    });
    await prisma.userRole.upsert({
      where: { id: (await prisma.userRole.findFirst({ where: { userId: u.id, roleId: studentRole!.id, gymId: gym.id } }))?.id ?? 'noop' },
      update: {},
      create: { userId: u.id, roleId: studentRole!.id, gymId: gym.id },
    });
    const s = await prisma.student.upsert({
      where: { id: (await prisma.student.findFirst({ where: { userId: u.id, gymId: gym.id } }))?.id ?? 'noop' },
      update: {},
      create: {
        gymId: gym.id, userId: u.id, goal: a.goal, level: a.level, status: 'ACTIVE',
        consentHealth: true, consentComm: true, consentBiometry: true,
      },
    });
    students.push(s);

    // avaliacao fisica
    await prisma.assessment.upsert({
      where: { id: (await prisma.assessment.findFirst({ where: { studentId: s.id } }))?.id ?? 'noop' },
      update: {},
      create: { studentId: s.id, weight: 70, height: 1.7, bmi: 24.2, bodyFatPercent: 18 },
    });

    // cobranca (amount em centavos)
    await prisma.charge.upsert({
      where: { id: (await prisma.charge.findFirst({ where: { studentId: s.id, gymId: gym.id } }))?.id ?? 'noop' },
      update: {},
      create: { gymId: gym.id, studentId: s.id, amount: 14990, dueDate: new Date(Date.now() + 5 * 86400000), status: 'PENDING' },
    });
  }

  // ---- EXERCICIOS ----
  const exDefs = [
    { name: 'Supino Reto', muscleGroup: 'Peito' },
    { name: 'Remada Curvada', muscleGroup: 'Costas' },
    { name: 'Agachamento Livre', muscleGroup: 'Pernas' },
  ];
  const exercises: { id: string }[] = [];
  for (const e of exDefs) {
    const ex = await prisma.exercise.upsert({ where: { name: e.name }, update: {}, create: { name: e.name, muscleGroup: e.muscleGroup } });
    exercises.push(ex);
  }

  // ---- TREINO APROVADO (Ana) ----
  const workout = await prisma.workout.upsert({
    where: { id: (await prisma.workout.findFirst({ where: { studentId: students[0].id } }))?.id ?? 'noop' },
    update: {},
    create: { studentId: students[0].id, goal: 'Hipertrofia', weeklyFrequency: 4, status: 'APPROVED' },
  });
  const session = await prisma.workoutSession.upsert({
    where: { id: (await prisma.workoutSession.findFirst({ where: { workoutId: workout.id } }))?.id ?? 'noop' },
    update: {},
    create: { workoutId: workout.id, name: 'Treino A - Peito e Triceps', order: 1 },
  });
  await prisma.workoutExercise.upsert({
    where: { id: (await prisma.workoutExercise.findFirst({ where: { sessionId: session.id, exerciseId: exercises[0].id } }))?.id ?? 'noop' },
    update: {},
    create: { sessionId: session.id, exerciseId: exercises[0].id, order: 1, sets: 4, reps: '10', restSeconds: 90 },
  });

  // ---- HORARIO ----
  await prisma.scheduleSlot.upsert({
    where: { id: (await prisma.scheduleSlot.findFirst({ where: { gymId: gym.id, weekday: 1, startTime: '18:00' } }))?.id ?? 'noop' },
    update: {},
    create: { gymId: gym.id, weekday: 1, startTime: '18:00', endTime: '19:00', capacity: 12 },
  });

  console.log('Seed IronCloud concluido!');
  console.log('   Academia: IronCloud Gym');
  console.log('   Dono: dono@ironcloud.com / admin123');
  console.log('   Alunos: ana.souza / bruno.lima / carla.dias @email.com (senha: aluno123)');
  console.log('   Super Admin: admin@gym-saas.com / admin123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });