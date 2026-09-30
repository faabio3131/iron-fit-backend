import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  ActionTokenDto,
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  EmailOnlyDto,
  MfaConfirmDto,
  MfaDisableDto,
  MfaSetupDto,
  PasswordResetConfirmDto,
  RequestEmailChangeDto,
  RevokeSessionDto,
  StepUpDto,
} from './dto/identity-security.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

function requestIp(req: any): string | null {
  return typeof req?.ip === 'string' && req.ip ? req.ip : null;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  login(@Req() req: any, @Body() dto: LoginDto) {
    return this.authService.login(
      req.user,
      dto.gymId,
      dto.mfaCode,
      dto.recoveryCode,
      requestIp(req),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('password/reset/request')
  @HttpCode(202)
  requestPasswordReset(@Req() req: any, @Body() dto: EmailOnlyDto) {
    return this.authService.requestPasswordReset(dto.email, requestIp(req));
  }

  @Post('password/reset/confirm')
  @HttpCode(200)
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto.token, dto.newPassword);
  }

  @Post('email/verification/request')
  @HttpCode(202)
  requestEmailVerification(@Req() req: any, @Body() dto: EmailOnlyDto) {
    return this.authService.requestEmailVerification(dto.email, requestIp(req));
  }

  @Post('email/verification/confirm')
  @HttpCode(200)
  confirmEmailVerification(@Body() dto: ActionTokenDto) {
    return this.authService.confirmEmailVerification(dto.token);
  }

  @Post('email/change/confirm')
  @HttpCode(200)
  confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @Post('step-up')
  @HttpCode(200)
  stepUp(@CurrentUser() user: any, @Body() dto: StepUpDto) {
    return this.authService.grantAdministrativeStepUp(
      user.id,
      user.sessionId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('step-up/status')
  stepUpStatus(@CurrentUser() user: any) {
    return this.authService.getAdministrativeStepUpStatus(
      user.id,
      user.sessionId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('password/change')
  @HttpCode(200)
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('email/change/request')
  @HttpCode(202)
  requestEmailChange(
    @CurrentUser() user: any,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.authService.requestEmailChange(
      user.id,
      dto.currentPassword,
      dto.newEmail,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@CurrentUser() user: any) {
    return this.authService.listSessions(user.id, user.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke')
  @HttpCode(200)
  revokeSession(@CurrentUser() user: any, @Body() dto: RevokeSessionDto) {
    return this.authService.revokeSession(
      user.id,
      dto.sessionId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOtherSessions(@CurrentUser() user: any, @Body() dto: StepUpDto) {
    return this.authService.revokeOtherSessions(
      user.id,
      user.sessionId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentUser() user: any, @Body() dto: MfaSetupDto) {
    return this.authService.beginMfaEnrollment(user.id, dto.currentPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/confirm')
  @HttpCode(200)
  confirmMfa(@CurrentUser() user: any, @Body() dto: MfaConfirmDto) {
    return this.authService.confirmMfaEnrollment(user.id, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @HttpCode(200)
  disableMfa(@CurrentUser() user: any, @Body() dto: MfaDisableDto) {
    return this.authService.disableMfa(
      user.id,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }
}
