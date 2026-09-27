import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";
import { useOrderReadiness, type ReadinessItem } from "@/hooks/use-manufacturing";

const label = (status: string) => status.replaceAll("_", " ");

function ReadinessLine({ item, name }: { item: ReadinessItem; name: string }) {
  return <div data-testid={`readiness-item-${item.orderItemId}`} className="border-t px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold">{name}</h4><span className="text-xs text-muted-foreground font-mono">Order line #{item.orderItemId}</span></div>
      <span data-testid={`status-readiness-item-${item.orderItemId}`} className={`text-[11px] font-bold uppercase tracking-wide ${item.manualReviewRequired ? "text-amber-800" : item.status === "FULLY_ALLOCATED" ? "text-emerald-700" : "text-amber-700"}`}>{item.manualReviewRequired ? "Staff review required" : label(item.status)}</span>
    </div>
    {item.components.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-xs text-left min-w-[440px]">
      <thead className="text-muted-foreground uppercase tracking-wide"><tr><th className="pb-2 font-semibold">Component</th><th className="pb-2 text-right font-semibold">Required</th><th className="pb-2 text-right font-semibold">Allocated</th><th className="pb-2 text-right font-semibold">Shortfall</th></tr></thead>
      <tbody className="divide-y">{item.components.map(component => <tr key={component.componentId} className={component.status === "RELEASED" ? "bg-muted/40 text-muted-foreground" : ""}>
        <td className="py-2 pr-3">
          <Link href={`/components?componentId=${component.componentId}`} data-testid={`link-readiness-component-${item.orderItemId}-${component.componentId}`} className="font-medium text-primary hover:underline" title="Inspect in components catalogue">{component.componentName}</Link>
          <span className="block font-mono text-muted-foreground">{component.componentSku || `#${component.componentId}`}</span>
          {component.status === "RELEASED" && <span className="block text-[11px] font-semibold uppercase tracking-wide">Released · history only, not reserved</span>}
          {component.manualReviewRequired && <span data-testid={`text-manual-review-reason-${item.orderItemId}-${component.componentId}`} className="block mt-1 max-w-sm text-xs font-medium text-amber-800"><TriangleAlert className="inline h-3 w-3 mr-1" />{component.manualReviewReason || "Payment received; component stock needs staff review before proceeding."}</span>}
        </td>
        <td className="py-2 text-right tabular-nums">{component.required}</td>
        <td className="py-2 text-right tabular-nums">{component.allocated}</td>
        <td data-testid={`text-shortfall-${item.orderItemId}-${component.componentId}`} className={`py-2 text-right tabular-nums font-semibold ${component.status === "RELEASED" ? "text-muted-foreground" : component.shortfall > 0 || component.manualReviewRequired ? "text-amber-700" : "text-emerald-700"}`}>{component.shortfall}</td>
      </tr>)}</tbody>
    </table></div> : <p className="mt-2 text-xs text-muted-foreground">No physical component requirements for this line.</p>}
  </div>;
}

export function OrderReadinessPanel({ orderId, items }: { orderId: number; items: Array<{ id: number; productName: string; colour?: string | null; size?: string | null }> }) {
  const readiness = useOrderReadiness(orderId);
  return <section data-testid="order-component-readiness" className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
    <div className="px-4 py-4 sm:px-5 border-b bg-muted/10 flex flex-wrap justify-between gap-3">
      <div><h2 className="font-display font-semibold text-lg">Component readiness</h2><p className="text-xs text-muted-foreground">Physical inputs allocated to this order. Separate from production and dispatch status.</p></div>
      {readiness.data && readiness.data.items.length > 0 && <span data-testid="status-order-readiness" className={`self-start rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${readiness.data.manualReviewRequired ? "bg-amber-100 text-amber-950 border-amber-300" : readiness.data.status === "FULLY_ALLOCATED" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-900 border-amber-200"}`}>{readiness.data.manualReviewRequired ? "STAFF REVIEW REQUIRED" : label(readiness.data.status)}</span>}
    </div>
    {readiness.data?.manualReviewRequired && <div data-testid="banner-payment-component-review" role="alert" className="flex gap-3 border-b border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 sm:px-5">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <div><strong className="block text-sm">Payment received — component stock needs staff review</strong><p className="mt-1 text-xs leading-5">Do not treat this order as fully ready, even if stock counts have since changed. Review the flagged components below; confirmation is blocked while review remains unresolved.</p></div>
    </div>}
    {readiness.isLoading ? <div className="p-5 space-y-2"><div className="h-8 animate-pulse rounded bg-muted w-1/3" /><div className="h-20 animate-pulse rounded bg-muted" /></div> :
      readiness.isError ? <div className="p-5 text-sm text-destructive">Component readiness unavailable. Do not assume this order is ready. <Button variant="outline" size="sm" className="ml-2" onClick={() => readiness.refetch()}>Retry</Button></div> :
      readiness.data?.items.length ? readiness.data.items.map(item => <ReadinessLine key={item.orderItemId} item={item} name={(() => { const orderItem = items.find(i => i.id === item.orderItemId); return orderItem ? [orderItem.productName, orderItem.colour, orderItem.size].filter(Boolean).join(" / ") : `Order line #${item.orderItemId}`; })()} />) :
      <p className="p-5 text-sm text-muted-foreground">No component-managed lines on this order. Existing stock workflows remain unchanged.</p>}
  </section>;
}