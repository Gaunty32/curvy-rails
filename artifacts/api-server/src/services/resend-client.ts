// Resend email client.
// Prefers RESEND_API_KEY env var; falls back to Replit Connectors credential proxy.
// WARNING: Never cache this client. Call getResendClient() fresh each time.
import { Resend } from "resend";

async function getCredentials(): Promise<{ apiKey: string }> {
  // Direct env var takes priority (most reliable)
  if (process.env.RESEND_API_KEY) {
    return { apiKey: process.env.RESEND_API_KEY };
  }

  // Fallback: Replit Connectors proxy
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Resend not connected: set RESEND_API_KEY secret");
  }

  const data = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  ).then((r) => r.json());

  const settings = data?.items?.[0]?.settings;
  if (!settings?.api_key) throw new Error("Resend not connected");

  return { apiKey: settings.api_key };
}

export async function getResendClient() {
  const { apiKey } = await getCredentials();
  return { client: new Resend(apiKey), fromEmail: null };
}
