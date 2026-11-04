export type TemplateExercise = { name: string; bodyweight?: boolean; sets?: number; reps?: string; restSeconds?: number };
type Session = { name: string; exercises: TemplateExercise[] };
const body = (name: string, reps = '10–12'): TemplateExercise => ({ name, bodyweight: true, sets: 2, reps, restSeconds: 60 });
const load = (name: string): TemplateExercise => ({ name, sets: 3, reps: '8–12', restSeconds: 90 });
// Versioned drafting aids, never an individualized prescription or approval.
export const WORKOUT_TEMPLATES: { id: string; name: string; goal: string; level: string; weeklyFrequency: number; sessions: Session[] }[] = [
  { id: 'adaptation', name: 'Adaptação', goal: 'Adaptação geral', level: 'INICIANTE', weeklyFrequency: 3, sessions: [{ name: 'A — Adaptação geral', exercises: [body('Agachamento com peso corporal'), body('Ponte de glúteos no solo'), body('Bird dog', '8–10 por lado'), body('Prancha com apoio de antebraços e joelhos', '15–20 s')] }] },
  { id: 'hypertrophy-ab', name: 'Hipertrofia A/B', goal: 'Hipertrofia', level: 'INTERMEDIARIO', weeklyFrequency: 4, sessions: [
    { name: 'A — Membros superiores', exercises: [load('Supino reto com halteres'), load('Remada unilateral com halter'), load('Desenvolvimento com halteres sentado')] },
    { name: 'B — Membros inferiores', exercises: [load('Leg press 45 graus'), load('Mesa flexora deitada'), load('Elevação pélvica com barra'), load('Panturrilha em pé na máquina')] },
  ] },
  { id: 'conditioning', name: 'Emagrecimento e condicionamento', goal: 'Condicionamento geral', level: 'INICIANTE', weeklyFrequency: 3, sessions: [{ name: 'A — Condicionamento', exercises: [{ name: 'Caminhada na esteira', sets: 1, reps: '10 min', restSeconds: 0 }, body('Agachamento com peso corporal'), body('Ponte de glúteos no solo'), body('Bird dog', '8–10 por lado')] }] },
  { id: 'lower-body', name: 'Glúteos e inferiores', goal: 'Fortalecimento de glúteos e inferiores', level: 'INTERMEDIARIO', weeklyFrequency: 3, sessions: [{ name: 'A — Glúteos e inferiores', exercises: [load('Elevação pélvica com barra'), load('Leg press 45 graus'), load('Abdução de quadril na máquina'), load('Stiff com halteres')] }] },
  { id: 'functional', name: 'Funcional', goal: 'Condicionamento funcional', level: 'INICIANTE', weeklyFrequency: 3, sessions: [{ name: 'A — Funcional', exercises: [body('Agachamento com peso corporal'), body('Afundo reverso', '8–10 por lado'), body('Bird dog', '8–10 por lado'), body('Marcha com joelhos altos', '30 s')] }] },
];
