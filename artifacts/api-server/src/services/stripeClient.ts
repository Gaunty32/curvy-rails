import Stripe from "stripe";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

const STRIPE_WRITE_METHODS = new Set([
  "create", "update", "delete", "del", "attach", "detach", "cancel", "capture",
  "confirm", "refund", "voidInvoice", "finalizeInvoice", "pay", "sendInvoice",
  "markUncollectible", "expire", "submit", "verify", "reject", "release",
  "deauthorize", "close", "complete", "consume", "increment", "decrement", "archive",
]);

function guardStripeWrites(client: Stripe): Stripe {
  const proxies = new WeakMap<object, object>();
  const wrap = (target: object): object => {
    const cached = proxies.get(target);
    if (cached) return cached;
    const proxy = new Proxy(target, {
      get(resource, property) {
        const value = Reflect.get(resource, property, resource);
        if (typeof value === "function") {
          if (typeof property === "string" && STRIPE_WRITE_METHODS.has(property)) {
            return async (...args: unknown[]) => {
              await assertIntegrationOutboundAllowed("stripe");
              return Reflect.apply(value, resource, args);
            };
          }
          return (...args: unknown[]) => Reflect.apply(value, resource, args);
        }
        if (value && typeof value === "object") return wrap(value);
        return value;
      },
    });
    proxies.set(target, proxy);
    return proxy;
  };
  return wrap(client) as Stripe;
}

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  // Prefer direct environment secrets if set
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY) {
    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
  }

  // Fall back to Replit Connectors
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (hostname && xReplitToken) {
    const connectorName = "stripe";
    const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
    const targetEnvironment = isProduction ? "production" : "development";

    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set("include_secrets", "true");
    url.searchParams.set("connector_names", connectorName);
    url.searchParams.set("environment", targetEnvironment);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    });

    const data = await response.json() as {
      items?: Array<{ settings?: { publishable?: string; secret?: string } }>;
    };
    const connectionSettings = data.items?.[0];

    if (connectionSettings?.settings?.publishable && connectionSettings?.settings?.secret) {
      return {
        publishableKey: connectionSettings.settings.publishable,
        secretKey: connectionSettings.settings.secret,
      };
    }
  }

  throw new Error(
    "Stripe keys not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY environment variables."
  );
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();
  return guardStripeWrites(new Stripe(secretKey, { apiVersion: "2025-08-27.basil" as any }));
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}
