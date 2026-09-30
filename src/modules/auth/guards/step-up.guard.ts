import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { StepUpService } from '../step-up.service';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly stepUp: StepUpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest()?.user;
    if (typeof user?.id !== 'string' || typeof user?.sessionId !== 'string') {
      throw new ForbiddenException('Reautenticacao administrativa necessaria');
    }
    await this.stepUp.assertActive(user.id, user.sessionId);
    return true;
  }
}
