import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessTerminalService } from './access-terminal.service';
import { TerminalCheckInDto } from './dto/terminal-check-in.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessTerminalController {
  constructor(private readonly terminal: AccessTerminalService) {}

  @Post('access/terminal/check-in')
  @Roles('OWNER', 'MANAGER', 'RECEPTION')
  checkIn(@CurrentUser() user: any, @Body() dto: TerminalCheckInDto) {
    return this.terminal.checkIn(user.activeGymId ?? user.gymId, user.id, dto);
  }

  @Post('me/access/qr-code')
  @Roles('STUDENT')
  myQr(@CurrentUser() user: any) {
    return this.terminal.myQr(user.activeGymId ?? user.gymId, user.id);
  }
}
