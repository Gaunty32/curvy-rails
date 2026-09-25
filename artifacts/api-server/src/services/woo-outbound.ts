import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

export async function assertWooIntegrationAllowed(): Promise<void> {
  await assertIntegrationOutboundAllowed("woocommerce");
}

export async function wooRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  await assertWooIntegrationAllowed();
  return fetch(input, init);
}