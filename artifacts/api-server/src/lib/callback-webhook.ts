import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

export type WebhookFetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function postCallbackWebhook(
  url: string,
  payload: Record<string, unknown>,
  fetcher: WebhookFetcher = fetch,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await assertIntegrationOutboundAllowed("webhook");
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Webhook request failed" };
  } finally {
    clearTimeout(timer);
  }
}