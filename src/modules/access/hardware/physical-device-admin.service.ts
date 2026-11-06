import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ConfigurePhysicalFirmwareDto, RegisterPhysicalDeviceDto } from '../dto/register-physical-device.dto';
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

  async configureFirmware(
    gymId: string,
    actorId: string,
    deviceId: string,
    dto: ConfigurePhysicalFirmwareDto,
  ) {
    if (!gymId || !actorId) throw new ConflictException('Identidade/academia obrigatoria');
    const firmwareVersion = dto.firmwareVersion.trim();
    if (!firmwareVersion) throw new ConflictException('Versao do firmware obrigatoria');
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.accessDevice.findFirst({
        where: { id: deviceId, gymId, active: false },
        select: { id: true, firmwareVersion: true },
      });
      if (!device) throw new NotFoundException('Dispositivo inativo nao encontrado');
      if (device.firmwareVersion === firmwareVersion) return { id: device.id, firmwareVersion };
      const updated = await tx.accessDevice.updateMany({
        where: { id: device.id, gymId, active: false },
        data: {
          firmwareVersion,
          certificationStatus: 'NOT_HOMOLOGATED',
          certificationRef: null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('Dispositivo alterado durante a configuracao');
      await this.audit.record({
        gymId, userId: actorId, action: 'ACCESS_DEVICE_FIRMWARE_CONFIGURED',
        entity: 'AccessDevice', entityId: device.id,
        previous: { firmwareVersion: device.firmwareVersion },
        next: { firmwareVersion, certificationStatus: 'NOT_HOMOLOGATED' },
      }, tx);
      return { id: device.id, firmwareVersion, certificationStatus: 'NOT_HOMOLOGATED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setActive(gymId: string, actorId: string, deviceId: string, active: boolean) {
    if (!gymId || !actorId) throw new ConflictException('Identidade/academia obrigatoria');
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: deviceId, gymId },
    });
    if (!device) throw new NotFoundException('Dispositivo nao encontrado');
    if (device.active === active) return { id: device.id, active };
    if (active) {
      if (!device.deviceTokenHash || !device.manufacturer || !device.model || !device.firmwareVersion) {
        throw new ConflictException('Dispositivo ainda nao provisionado');
      }
      // No tenant may activate unverified hardware by merely selecting a brand.
      if (device.certificationStatus !== 'PRODUCTION_HOMOLOGATED' || !device.certificationRef) {
        throw new ConflictException('Homologacao externa do modelo/firmware obrigatoria');
      }
      if (['TOPDATA', 'HENRY', 'DIMEP'].includes(device.manufacturer)) {
        // The SDK runs in the gym LAN; its reverse-poll client does not exist
        // inside the cloud runtime. External certification is authoritative.
      } else {
      const driver = this.registry.resolve(device.manufacturer as AccessManufacturer);
      if (!driver.supportsDevice({
        deviceId: device.id,
        gymId: device.gymId,
        manufacturer: device.manufacturer as AccessManufacturer,
        model: device.model,
        protocolVersion: device.firmwareVersion,
      })) {
        throw new ConflictException('Modelo ou firmware de catraca nao homologado');
      }
      }
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
