import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  IronCommercialConnector,
  IRON_COMMERCIAL_SECRET_REF,
  IRON_COMMERCIAL_SOURCE_TYPE,
} from "@/infrastructure/integration/iron-commercial-connector";

const realOrigin = new URL(process.env.B6_API_URL ?? "http://127.0.0.1:3333/api/v1").origin;
const allowedVirtualOrigin = "https://iron-contract-ci.invalid";
const token = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN ?? "";
const tenant = "fm-iron-internal-cert";

const source = {
  id: "iron-internal-contract-source",
  tenantId: tenant,
  productId: "IRON_FIT_CORE",
  name: "IRON commercial CI connector",
  sourceType: IRON_COMMERCIAL_SOURCE_TYPE,
  authoritativeDomain: "commercial",
  status: "configured" as const,
  syncMode: "pull" as const,
  secretRef: IRON_COMMERCIAL_SECRET_REF,
  config: { baseUrl: allowedVirtualOrigin },
  freshnessSeconds: 300,
  mappingVersion: "iron-commercial-v1",
};

const context = { tenantId: tenant, correlationId: "iron-e2e-" + randomUUID(), timeoutMs: 30000 };
// Only in ephemeral CI: exercise Command's real, HTTPS-only connector against the
// real backend through a loopback HTTP transport adapter. This does not certify TLS.
const transport: typeof fetch = (input, init) => {
  const target = new URL(String(input));
  if (target.origin !== allowedVirtualOrigin) {
    throw new Error("iron_ci_connector_origin_mismatch");
  }
  return fetch(realOrigin + target.pathname + target.search, init);
};

describe("IRON real FM Command consumer ↔ Nest/PostgreSQL S2S interoperability", () => {
  it("validates published plan catalog, commercial snapshot, S2S commands and replay", async () => {
    expect(token.length).toBeGreaterThanOrEqual(32);
    const connector = new IronCommercialConnector(() => token, transport, () => [allowedVirtualOrigin], () => tenant);
    expect(await connector.health(context, source)).toBe("healthy");
    const catalog = await connector.publishedPlanVersions(context, source);
    expect(Array.isArray(catalog.plans)).toBe(true);
    const aiUsage = await connector.aiUsage(context, source);
    expect(aiUsage.metric).toBe("ai_execution_trace_count");

    const marker = randomUUID().slice(0, 8);
    const trial = await fetch(realOrigin + "/api/v1/commercial/trial/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: randomUUID(),
        name: "FM Command Connector QA",
        gymName: "FMCC Real Consumer QA " + marker,
        email: "command-consumer-" + marker + "@example.com",
        password: process.env.B6_OWNER_PASSWORD,
        timezone: "America/Sao_Paulo",
      }),
    });
    expect(trial.status).toBe(201);
    const created = await trial.json() as { gymId: string; subscriptionId: string };
    expect(created.gymId).toBeTruthy();
    expect(created.subscriptionId).toBeTruthy();

    const snapshot = await connector.snapshot(context, source);
    expect(snapshot.coverage.billing_transactions).toBe("FM_COMMAND_AUTHORITY");
    expect(snapshot.subscriptions.some(row => row.external_id === created.subscriptionId)).toBe(true);
    const pulled = await connector.pull(context, source);
    expect(pulled.facts.some(fact => fact.factType === "iron.subscription")).toBe(true);

    const command = {
      action: "subscription.status.sync" as const,
      gymId: created.gymId,
      expectedSubscriptionId: created.subscriptionId,
      commercialStatus: "suspended" as const,
      entitlementStatus: "SUSPENDED" as const,
      reason: "CI linked consumer entitlement hold",
    };
    const key = "consumer-e2e-" + randomUUID();
    const first = await connector.subscriptionCommand(context, source, command, key);
    expect(first.idempotent).toBe(false);
    const replay = await connector.subscriptionCommand(context, source, command, key);
    expect(replay.idempotent).toBe(true);
    await expect(connector.subscriptionCommand(context, source, {
      ...command, commercialStatus: "active", entitlementStatus: "ACTIVE",
    }, key)).rejects.toThrow("integration.iron_subscription_command_rejected");

    const resumed = await connector.subscriptionCommand(context, source, {
      ...command, commercialStatus: "active", entitlementStatus: "ACTIVE",
      reason: "CI verified billing reconciliation",
    }, "consumer-reconcile-" + randomUUID());
    expect((resumed.result as Record<string, unknown>).entitlementStatus).toBe("ACTIVE");

    await expect(connector.snapshot({ ...context, tenantId: "other-control-tenant" }, source))
      .rejects.toThrow("integration.iron_control_tenant_denied");
    console.log(JSON.stringify({
      event: "iron_actual_command_connector_live_backend_certification",
      publishedPlanCatalog: true, snapshot: true, pull: true,
      aiUsage: true, suspendResume: true, replaySafe: true, controlTenantDenied: true,
      httpsBoundary: "virtual-origin / loopback-only CI (NOT external TLS certification)",
    }));
  }, 90000);
});
