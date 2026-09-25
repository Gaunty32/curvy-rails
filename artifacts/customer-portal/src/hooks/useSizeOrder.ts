import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { API_BASE } from "@/lib/api";

export function useSizeOrder(): string[] {
  const { data: settings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API_BASE}/settings`).then(r => r.json()),
    staleTime: 1000 * 60 * 10,
  });

  return useMemo<string[]>(() => {
    const raw = settings?.["size_order"];
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }, [settings]);
}
