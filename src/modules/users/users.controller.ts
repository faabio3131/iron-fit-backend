import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMembershipStatusDto } from './dto/update-membership-status.dto';
import { UpdateMembershipRoleDto } from './dto/update-membership-role.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
    return this.usersService.create(dto, user);
  }

  @Post('invite')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: any) {
    return this.usersService.invite(dto, user);
  }

  @Patch(':userId/membership/status')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  updateMembershipStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateMembershipStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.updateMembershipStatus(userId, dto.active, user);
  }

  @Patch(':userId/membership/role')
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  updateMembershipRole(
    @Param('userId') userId: string,
    @Body() dto: UpdateMembershipRoleDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.updateMembershipRole(userId, dto.roleName, user);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'OWNER', 'MANAGER')
  findAll(@CurrentUser() user: any) {
    return this.usersService.findAll(user);
  }
}
