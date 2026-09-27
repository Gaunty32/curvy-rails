import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetManufacturingAvailabilityPolicyQueryKey,
  useGetManufacturingAvailabilityPolicy,
  useUpdateManufacturingAvailabilityPolicy,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { staffAuthHeader } from "@/lib/staff-auth";

type Policy = { lowStockThreshold: number; holdDurationMinutes: number };

function PolicyForm({ initial }: { initial: Policy }) {
  const [threshold, setThreshold] = useState(String(initial.lowStockThreshold));
  const [minutes, setMinutes] = useState(String(initial.holdDurationMinutes));
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = useUpdateManufacturingAvailabilityPolicy({
    request: { headers: staffAuthHeader(), credentials: "include" },
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetManufacturingAvailabilityPolicyQueryKey() }),
          queryClient.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].endsWith("/availability") }),
        ]);
        toast({ title: "Availability policy saved" });
      },
      onError: error => toast({ title: "Could not save availability policy", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" }),
    },
  });
  const validThreshold = /^\d+$/.test(threshold) && Number.isSafeInteger(Number(threshold));
  const validMinutes = /^\d+$/.test(minutes) && Number.isSafeInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440;
  const dirty = Number(threshold) !== initial.lowStockThreshold || Number(minutes) !== initial.holdDurationMinutes;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validThreshold || !validMinutes || !dirty || save.isPending) return;
    save.mutate({ data: { lowStockThreshold: Number(threshold), holdDurationMinutes: Number(minutes) } });
  };
  return <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
    <label className="text-xs font-semibold text-muted-foreground">LOW-STOCK THRESHOLD
      <Input data-testid="input-low-stock-threshold" className="mt-1 w-36 h-9 tabular-nums" type="number" min="0" step="1" required value={threshold} onChange={event => setThreshold(event.target.value)} aria-invalid={!validThreshold} />
    </label>
    <label className="text-xs font-semibold text-muted-foreground">CHECKOUT HOLD (MINUTES)
      <Input data-testid="input-hold-duration-minutes" className="mt-1 w-36 h-9 tabular-nums" type="number" min="1" max="1440" step="1" required value={minutes} onChange={event => setMinutes(event.target.value)} aria-invalid={!validMinutes} />
    </label>
    <Button data-testid="button-save-global-availability-policy" type="submit" size="sm" variant="outline" className="h-9" disabled={!validThreshold || !validMinutes || !dirty || save.isPending}>{save.isPending ? "Saving…" : "Save policy"}</Button>
    {(!validThreshold || !validMinutes) && <span role="alert" className="w-full text-xs text-destructive">Use whole numbers: threshold ≥ 0, hold duration 1–1440 minutes.</span>}
  </form>;
}

export function AvailabilityPolicyControl() {
  const query = useGetManufacturingAvailabilityPolicy({
    request: { headers: staffAuthHeader(), credentials: "include" },
  });
  return <section data-testid="global-availability-policy" className="rounded-xl border bg-card px-4 py-4 sm:px-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-sm">
        <h2 className="text-sm font-semibold">Availability settings</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Low-stock display and checkout hold lifetime. Holds expire automatically; expired holds stop reducing available stock.</p>
      </div>
      {query.isLoading ? <div className="h-9 w-full max-w-sm animate-pulse rounded bg-muted" /> :
        query.isError ? <p className="text-sm text-destructive">Settings unavailable. <Button variant="outline" size="sm" className="ml-2" onClick={() => query.refetch()}>Retry</Button></p> :
        query.data ? <PolicyForm initial={query.data} /> : <p className="text-sm text-muted-foreground">No policy returned.</p>}
    </div>
  </section>;
}