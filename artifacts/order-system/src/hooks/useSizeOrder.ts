import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export function useSizeOrder(): string[] {
  const { data: settings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 1000 * 60 * 10,
  });

  return useMemo<string[]>(() => {
    const raw = settings?.["size_order"];
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }, [settings]);
}
