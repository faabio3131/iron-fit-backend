import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { FiscalReconciliationCancellationService } from './fiscal-reconciliation-cancellation.service';

const FISCAL_DISPATCH_INTERVAL_MS = 10_000;

@Injectable()
export class FiscalBridgeMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dispatch: FiscalBridgeDispatchService,
    private readonly lifecycle: FiscalReconciliationCancellationService,
  ) {}

  onModuleInit() {
    if (
      this.config
        .get<string>('FISCAL_BRIDGE_DISPATCH_ENABLED')
        ?.trim()
        .toLowerCase() !== 'true'
    ) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runCycle();
    }, FISCAL_DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatch.dispatchDue();
      await this.lifecycle.reconcileDue();
      await this.lifecycle.resumeCancellations();
    } catch {
      // The next governed cycle retries capability-stage failures.
      // Issuance-stage uncertainty is persisted as RECONCILIATION_PENDING.
    } finally {
      this.running = false;
    }
  }
}
