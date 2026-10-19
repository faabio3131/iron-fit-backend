import { Prisma } from '@prisma/client';

// Whitelist operational user data; never return authentication or MFA material.
export const publicUserSelect = { id: true, name: true, email: true, phone: true, active: true, createdAt: true } satisfies Prisma.UserSelect;
