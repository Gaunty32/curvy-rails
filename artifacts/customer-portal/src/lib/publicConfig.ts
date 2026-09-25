import { useQuery } from "@tanstack/react-query";

export interface PublicBusinessConfig {
  businessName?: string;
  tradingName?: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
  faviconUrl?: string;
  setupMode?: boolean;
  widgets?: {
    leadConnectorChat?: { widgetId: string; locationId: string } | null;
  };
}

/** Read-only installation branding; missing config is a deliberate setup state. */
export function usePublicConfig() {
  return useQuery<PublicBusinessConfig>({
    queryKey: ["public-business-config"],
    queryFn: async () => {
      const response = await fetch("/api/public-config", { credentials: "same-origin" });
      if (!response.ok) return { setupMode: true };
      return (await response.json()) as PublicBusinessConfig;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}