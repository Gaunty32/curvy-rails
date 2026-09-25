import { useEffect, useState } from "react";

const API_BASE = "/api";

export interface BusinessConfig {
  name: string;
  tradingName: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  logoUrl: string | null;
  setupMode: boolean;
}

export const SAFE_SETUP_CONFIG: BusinessConfig = {
  name: "Your business",
  tradingName: "Your business",
  website: "",
  email: "",
  phone: "",
  address: "",
  logoUrl: null,
  setupMode: true,
};

/**
 * Reads only public, non-secret installation identity. The API must return
 * setup-safe placeholders until the installation is explicitly activated.
 * No client-side default contains a source-install identity.
 */
export function useBusinessConfig(): BusinessConfig {
  const [config, setConfig] = useState<BusinessConfig>(SAFE_SETUP_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/public-config`, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Public business configuration unavailable");
        return response.json() as Promise<Partial<BusinessConfig>>;
      })
      .then((remote) => {
        if (cancelled) return;
        setConfig({
          ...SAFE_SETUP_CONFIG,
          ...remote,
          setupMode: remote.setupMode !== false,
        });
      })
      .catch(() => {
        // Keep the safe setup state. Never infer identity from client source.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

export function businessDisplayName(config: BusinessConfig): string {
  return config.tradingName || config.name || SAFE_SETUP_CONFIG.tradingName;
}