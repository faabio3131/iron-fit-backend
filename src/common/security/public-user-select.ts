import { Prisma } from '@prisma/client';

// Identity fields allowed in operational responses; never authentication material.
export const publicUserSelect = { id: true, name: true, email: true, phone: true, active: true, createdAt: true } satisfies Prisma.UserSelect;
