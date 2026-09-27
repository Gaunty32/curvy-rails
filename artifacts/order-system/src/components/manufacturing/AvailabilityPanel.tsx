import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useComponentAvailability, type AvailabilityConsumer } from "@/hooks/use-manufacturing";

function ConsumerList({ title, rows }: { title: string; rows: AvailabilityConsumer[] }) {
  return <div className="min-w-0">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title} <span className="tabular-nums">({rows.length})</span></h4>
    {rows.length ? <div className="divide-y rounded-lg border bg-background/60">
      {rows.map(row => <div key={row.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
        <div className="min-w-0">
          {row.orderId ? <Link data-testid={`link-allocation-order-${row.id}`} href={`/orders/${row.orderId}`} className="font-medium text-primary hover:underline">{row.reference || `Order #${row.orderId}`}</Link> : <span className="font-medium break-all">{row.reference || `Reference #${row.id}`}</span>}
          {row.expiresAt && <span className="block text-xs text-muted-foreground">Expires {new Date(row.expiresAt).toLocaleString("en-GB")}</span>}
        </div>
        <strong className="tabular-nums shrink-0">{row.quantity}</strong>
      </div>)}
    </div> : <p className="text-xs text-muted-foreground">None currently consuming stock.</p>}
  </div>;
}

export function AvailabilityPanel({ componentId }: { componentId: number }) {
  const availability = useComponentAvailability(componentId);
  return <section data-testid="component-availability" className="border-b bg-primary/[0.035] p-5">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div><h3 className="text-sm font-semibold">Availability ledger</h3><p className="text-xs text-muted-foreground">Physical units minus active, nonexpired checkout holds and confirmed allocations.</p></div>
      {availability.data && <span className="text-[11px] text-muted-foreground whitespace-nowrap">Refreshes every 30s</span>}
    </div>
    {availability.isLoading ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[0,1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div> :
      availability.isError ? <div className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Availability cannot be verified. Do not infer it from the physical balance. <Button size="sm" variant="outline" className="ml-2" onClick={() => availability.refetch()}>Retry</Button></div> :
      availability.data && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([["Physical", availability.data.physical], ["Active holds", availability.data.activeHolds], ["Allocated", availability.data.confirmedAllocations], ["Available", availability.data.available]] as const).map(([label, value]) => <div key={label} className={`rounded-lg border px-3 py-3 ${label === "Available" ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}>
            <span className={`block text-[11px] font-semibold uppercase tracking-wide ${label === "Available" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</span>
            <strong data-testid={`text-component-${label.toLowerCase().replace(" ", "-")}`} className="block mt-1 text-xl tabular-nums">{value.toLocaleString()}</strong>
          </div>)}
        </div>
        <p className="mt-2 text-xs font-mono text-muted-foreground">{availability.data.physical} − {availability.data.activeHolds} − {availability.data.confirmedAllocations} = {availability.data.available} available</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ConsumerList title="Checkout holds" rows={availability.data.holds} />
          <ConsumerList title="Confirmed allocations" rows={availability.data.allocations} />
        </div>
      </>}
  </section>;
}