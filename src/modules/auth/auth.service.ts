import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { resolveActiveTenantContext } from './tenant-context';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            gym: {
              select: {
                id: true,
                name: true,
                active: true,
              },
            },
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      userRoles: user.userRoles,
    };
  }

  async login(user: any, requestedGymId?: string) {
    let context;

    try {
      context = resolveActiveTenantContext(user.userRoles, requestedGymId);
    } catch {
      throw new UnauthorizedException('Tenant invalido ou indisponivel');
    }

    if (context.requiresTenantSelection) {
      return {
        requires_tenant_selection: true,
        tenants: context.availableTenants,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }

    const payload = {
      sub: user.id,
      email: user.email,
      activeGymId: context.activeGymId,
      scope: context.scope,
    };

    return {
      access_token: this.jwtService.sign(payload),
      requires_tenant_selection: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: context.roles,
        permissions: context.permissions,
        gymId: context.activeGymId,
        activeGymId: context.activeGymId,
        isSuperAdmin: context.isSuperAdmin,
        scope: context.scope,
      },
    };
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email ja cadastrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        passwordHash,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }
}
