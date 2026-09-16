import { Injectable } from '@nestjs/common';
import { assertSecretReference } from '../contracts/ai-contract';

export interface AiSecretResolution {
  reference: string;
  available: boolean;
  reason?: 'SECRET_BACKEND_NOT_CONFIGURED';
}

@Injectable()
export class AiSecretReferenceService {
  resolveReference(secretReference: string): AiSecretResolution {
    const reference = assertSecretReference(secretReference);
    return Object.freeze({
      reference,
      available: false,
      reason: 'SECRET_BACKEND_NOT_CONFIGURED' as const,
    });
  }
}
