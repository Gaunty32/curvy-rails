import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type OpenPo = {
  id: number;
  poNumber: string;
  totalValue: number;
  remainingValue: number;
  usedValue: number;
  expiryDate: string;
  status: string;
};

interface OpenPoBannerProps {
  openPo: OpenPo | null | undefined;
  /** Order gross total (items + carriage, ex-VAT) to compare against balance */
  orderGross: number;
  /** Whether submission was blocked (either client-side or server rejection) */
  blocked: boolean;
  onBlock: () => void;
  onReplaced: (newPoNumber: string) => void;
  /** The data to re-submit once the replacement PO is set up */
  onRetrySubmit?: () => void;
}

export function OpenPoBanner({
  openPo,
  orderGross,
  blocked,
  onBlock,
  onReplaced,
  onRetrySubmit,
}: OpenPoBannerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replacementPoNumber, setReplacementPoNumber] = useState("");
  const [replacementPoExpiry, setReplacementPoExpiry] = useState("");
  const [replacementPoValue, setReplacementPoValue] = useState("");
  const [creating, setCreating] = useState(false);

  if (!openPo && !blocked) return null;

  const isLowBalance = openPo && openPo.remainingValue / openPo.totalValue < 0.2;
  const isExpiringSoon =
    openPo &&
    new Date(openPo.expiryDate) <=
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const handleCreate = async () => {
    if (!replacementPoNumber || !replacementPoExpiry || !replacementPoValue) return;
    const val = parseFloat(replacementPoValue);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Invalid value", description: "Authorised value must be a positive number.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/portal/open-po", {
        method: "POST",
        body: JSON.stringify({ poNumber: replacementPoNumber, totalValue: val, expiryDate: replacementPoExpiry }),
      });
      await queryClient.invalidateQueries({ queryKey: ["portal-open-po"] });
      onReplaced(replacementPoNumber);
      onRetrySubmit?.();
    } catch (err: any) {
      toast({ title: "Failed to create PO", description: err.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (blocked) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3 min-w-0">
            <div>
              <p className="text-sm font-semibold text-amber-800">Purchase order limit reached</p>
              <p className="text-xs text-amber-700 mt-0.5">
                This order ({formatCurrency(orderGross)}) exceeds your remaining open PO balance
                {openPo ? ` of ${formatCurrency(openPo.remainingValue)}` : ""}.
                Please provide a new authorised purchase order to continue.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">New PO number</Label>
                <Input
                  value={replacementPoNumber}
                  onChange={e => setReplacementPoNumber(e.target.value)}
                  placeholder="e.g. PO-2026-0043"
                  className="font-mono h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Authorised value (£, ex VAT)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={replacementPoValue}
                  onChange={e => setReplacementPoValue(e.target.value)}
                  placeholder="e.g. 25000"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expiry date</Label>
                <Input
                  type="date"
                  value={replacementPoExpiry}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={e => setReplacementPoExpiry(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-amber-600">
              The value you enter will be visible to the fulfilment team and can be adjusted by staff.
            </p>
            <Button
              size="sm"
              disabled={!replacementPoNumber || !replacementPoExpiry || !replacementPoValue || creating}
              onClick={handleCreate}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Set up new open PO and submit order
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Active open PO banner
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 flex items-start gap-3",
        isLowBalance || isExpiringSoon
          ? "border-amber-200 bg-amber-50/60"
          : "border-green-200 bg-green-50/50"
      )}
    >
      <FileText
        className={cn(
          "w-4 h-4 mt-0.5 shrink-0",
          isLowBalance || isExpiringSoon ? "text-amber-600" : "text-green-600"
        )}
      />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold">{openPo!.poNumber}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5",
              isLowBalance
                ? "border-amber-300 text-amber-700 bg-amber-50"
                : "border-green-300 text-green-700 bg-green-50"
            )}
          >
            Open PO
          </Badge>
          {isExpiringSoon && (
            <Badge variant="outline" className="text-[10px] px-1.5 border-orange-300 text-orange-700 bg-orange-50">
              Expires soon
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <span className={cn("font-semibold", isLowBalance ? "text-amber-700" : "text-green-700")}>
              {formatCurrency(openPo!.remainingValue)}
            </span>{" "}
            remaining of {formatCurrency(openPo!.totalValue)}
          </span>
          <span>· Expires {openPo!.expiryDate}</span>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-muted rounded-full overflow-hidden w-full max-w-xs">
          <div
            className={cn("h-full rounded-full", isLowBalance ? "bg-amber-400" : "bg-green-500")}
            style={{ width: `${Math.min(100, (openPo!.usedValue / openPo!.totalValue) * 100).toFixed(1)}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          This PO number will be automatically applied to your order.
        </p>
      </div>
    </div>
  );
}
