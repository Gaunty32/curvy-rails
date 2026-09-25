import { useQuery } from "@tanstack/react-query";

export interface PublicBusinessConfig {
  businessName?: string;
  tradingName?: string;
  website?: string;
  email?: string;
  phone?: string;
  whatsapp?: string | null;
  address?: string;
  logoUrl?: string;
  faviconUrl?: string;
  portalUrl?: string;
  setupMode?: boolean;
  widgets?: {
    endorsalReviews?: { widgetId: string; embedId: string } | null;
  };
}

/**
 * Read-only branding/configuration hook. The API is intentionally optional:
 * a fresh installation must render neutral setup copy rather than inheriting
 * source-business identity or inventing a fallback contact address.
 */
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

export const setupBusinessConfig: PublicBusinessConfig = {
  setupMode: true,
};