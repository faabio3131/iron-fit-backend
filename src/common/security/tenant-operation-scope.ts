import { BadRequestException, NotFoundException } from '@nestjs/common';

export function resolveTenantOperationGymId(params: {
  activeGymId?: string | null;
  requestedGymId?: string | null;
  isSuperAdmin?: boolean;
}): string {
  const { activeGymId, requestedGymId, isSuperAdmin = false } = params;

  if (isSuperAdmin) {
    if (!requestedGymId) {
      throw new BadRequestException('Academia obrigatoria para operacao global');
    }
    return requestedGymId;
  }

  if (!activeGymId) {
    throw new BadRequestException('Tenant ativo obrigatorio');
  }

  if (requestedGymId && requestedGymId !== activeGymId) {
    throw new NotFoundException('Academia nao encontrada');
  }

  return activeGymId;
}
