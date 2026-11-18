import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { StudentsService } = require('../dist/src/modules/students/students.service.js');

test('staff readback requires scoped student and never returns data for another gym', async () => {
  const calls = [];
  const service = new StudentsService({
    student: {
      findFirst: async (options) => {
        calls.push(['student', options]);
        return options.where.gymId === 'gym-a' ? {id: 'student-a'} : null;
      },
    },
    workoutExecution: {
      findMany: async (options) => {
        calls.push(['executions', options]);
        return [{id:'done-a',sessionName:'Treino A',completedSets:4,source:'STUDENT_SELF_REPORTED'}];
      },
    },
  }, {}, {});
  const rows = await service.getWorkoutExecutions('student-a', 'gym-a');
  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0][1].where,{id:'student-a',gymId:'gym-a'});
  assert.deepEqual(calls[1][1].where,{studentId:'student-a',gymId:'gym-a'});
  assert.deepEqual(calls[1][1].take,30);
  assert.deepEqual(Object.keys(calls[1][1].select).sort(),
    ['completedAt','completedSets','id','sessionId','sessionName','source','workoutGoal','workoutId']);
  await assert.rejects(()=>service.getWorkoutExecutions('student-a','gym-b'),/Aluno nao encontrado/);
  await assert.rejects(()=>service.getWorkoutExecutions('student-a',null),/Aluno nao encontrado/);
  assert.equal(calls.filter(([key])=>key==='executions').length,1);
});

test('coach route must be JWT/roles guarded and RECEPTION/STUDENT cannot access', async () => {
  const source = await readFile('src/modules/students/students.controller.ts','utf8');
  assert.match(source, /@Controller\('students'\)[\s\S]*?@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(source, /@Get\(':id\/workout-executions'\)\s*@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER'\)/);
  assert.match(source,/user\.activeGymId \?\? user\.gymId/);
  assert.doesNotMatch(source, /@Get\(':id\/workout-executions'\)\s*@Roles\([^)]*'RECEPTION'/);
});
