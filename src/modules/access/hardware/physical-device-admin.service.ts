import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { RegisterPhysicalDeviceDto } from '../dto/register-physical-device.dto';
import { PhysicalAccessDriverRegistry, AccessManufacturer } from './physical-access-driver';

/**
 * Enrollment never trusts a device's self-reported tenant, manufacturer or
 * credentials. New hardware is inactive until verified provisioning.
 */
@Injectable()
export class PhysicalDeviceAdminService {
  private readonly audit: AuditService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PhysicalAccessDriverRegistry,
  ) {
    this.audit = new AuditService(prisma);
  }

  async register(gymId: string, actorId: string, dto: RegisterPhysicalDeviceDto) {
    if (!gymId || !actorId) throw new ConflictException('Identidade/academia obrigatoria');
    const device = await this.prisma.accessDevice.create({
      data: {
        gymId,
        name: dto.name.trim(),
        model: dto.model.trim(),
        manufacturer: dto.manufacturer,
        protocol: null,
        type: dto.type,
        active: false,
        deviceTokenHash: null,
      },
      select: { id: true, name: true, model: true, manufacturer: true, active: true, type: true },
    });
    await this.audit.record({
      gymId, userId: actorId, action: 'ACCESS_DEVICE_REGISTERED',
      entity: 'AccessDevice', entityId: device.id,
      next: { manufacturer: device.manufacturer, model: device.model, active: false },
    });
    return device;
  }

  async setActive(gymId: string, actorId: string, deviceId: string, active: boolean) {
    if (!gymId || !actorId) throw new ConflictException('Identidade/academia obrigatoria');
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: deviceId, gymId },
    });
    if (!device) throw new NotFoundException('Dispositivo nao encontrado');
    if (device.active === active) return { id: device.id, active };
    if (active) {
      if (!device.deviceTokenHash || !device.manufacturer || !device.model) {
        throw new ConflictException('Dispositivo ainda nao provisionado');
      }
      // Never make unimplemented brands active by setting a DB flag.
      this.registry.resolve(device.manufacturer as AccessManufacturer);
    }
    const updated = await this.prisma.accessDevice.updateMany({
      where: { id: device.id, gymId, active: !active },
      data: { active },
    });
    if (updated.count !== 1) throw new ConflictException('Estado do dispositivo foi alterado');
    await this.audit.record({
      gymId, userId: actorId,
      action: active ? 'ACCESS_DEVICE_ACTIVATED' : 'ACCESS_DEVICE_DEACTIVATED',
      entity: 'AccessDevice', entityId: device.id,
      previous: { active: !active }, next: { active },
    });
    return { id: device.id, active };
  }
}
