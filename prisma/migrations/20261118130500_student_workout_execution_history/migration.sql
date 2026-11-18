-- Student-declared guided workout completion history, scoped to the authenticated academy.
-- This is not an attendance/access event; no workout prescription is modified here.
CREATE TABLE "WorkoutExecution" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "workoutGoal" TEXT,
    "completedSets" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'STUDENT_SELF_REPORTED',
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkoutExecution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkoutExecution_completedSets_check" CHECK ("completedSets" > 0),
    CONSTRAINT "WorkoutExecution_source_check" CHECK ("source" = 'STUDENT_SELF_REPORTED')
);
CREATE UNIQUE INDEX "WorkoutExecution_studentId_requestId_key" ON "WorkoutExecution"("studentId", "requestId");
CREATE INDEX "WorkoutExecution_gymId_studentId_completedAt_idx" ON "WorkoutExecution"("gymId", "studentId", "completedAt");
CREATE INDEX "WorkoutExecution_workoutId_sessionId_idx" ON "WorkoutExecution"("workoutId", "sessionId");
ALTER TABLE "WorkoutExecution" ADD CONSTRAINT "WorkoutExecution_gymId_fkey"
    FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutExecution" ADD CONSTRAINT "WorkoutExecution_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
