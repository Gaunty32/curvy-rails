import type { Request, RequestHandler } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const OUTBOUND_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export type OutboundIntegrationId =
  | "smtp" | "dpd" | "xero" | "stripe" | "woocommerce"
  | "highlevel" | "facebook" | "google_business" | "linkedin"
  | "invoco" | "webhook";

export type InstallationState = {
  setupMode: boolean;
  activated: boolean;
};

export function outboundWriteGate(getState: (request: Request) => Promise<InstallationState>): RequestHandler {
  return async (request, response, next) => {
    if (!OUTBOUND_WRITE_METHODS.has(request.method)) {
      next();
      return;
    }
    try {
      const state = await getState(request);
      if (state.setupMode || !state.activated) {
        response.status(423).json({ error: "Installation is in SETUP MODE; outbound writes are blocked." });
        return;
      }
    } catch {
      response.status(423).json({ error: "Installation state is unavailable; outbound writes are blocked." });
      return;
    }
    next();
  };
}

export function assertOutboundWriteAllowed(state: InstallationState): void {
  if (state.setupMode || !state.activated) {
    throw new Error("Outbound write blocked until installation activation.");
  }
}

/**
 * The durable integration_enabled setting is a JSON object keyed by integration
 * id (for example {"smtp":true}). Missing, malformed, or non-boolean values
 * are never interpreted as enabled. Credentials alone grant no capability.
 */
export async function assertIntegrationOutboundAllowed(integrationId: OutboundIntegrationId): Promise<void> {
  const [activation, capabilities] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "installation_activated")),
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "integration_enabled")),
  ]);
  if (activation[0]?.value !== "true") {
    throw new Error(`Outbound ${integrationId} write blocked: installation is not activated.`);
  }
  let enabled: unknown;
  try {
    enabled = JSON.parse(capabilities[0]?.value ?? "null");
  } catch {
    throw new Error("Outbound integration capability state is invalid; writes are blocked.");
  }
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)
    || (enabled as Record<string, unknown>)[integrationId] !== true) {
    throw new Error(`Outbound ${integrationId} integration is not explicitly enabled.`);
  }
}
