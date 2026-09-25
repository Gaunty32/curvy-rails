import { useCallback, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/utils";

export function isWholePound(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) < 0.001;
}

/**
 * Hook for confirming non-whole-pound prices before saving.
 * Unit prices are normally whole £ amounts — this prompts for explicit
 * confirmation whenever a price with pence is about to be saved.
 *
 * Usage:
 *   const { confirmIfNotWhole, dialog } = usePriceConfirm();
 *   const ok = await confirmIfNotWhole(details.unitPrice);
 *   if (!ok) return;
 *   ...proceed with save...
 *   // render {dialog} once, anywhere in the component's JSX
 */
export function usePriceConfirm() {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(0);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirmIfNotWhole = useCallback((value: number) => {
    if (isWholePound(value)) return Promise.resolve(true);
    setPrice(value);
    setOpen(true);
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = (result: boolean) => {
    setOpen(false);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  const dialog = (
    <AlertDialog open={open} onOpenChange={o => { if (!o) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Price includes pence</AlertDialogTitle>
          <AlertDialogDescription>
            You're about to save a price of <span className="font-semibold text-foreground">{formatCurrency(price)}</span>.
            Unit prices are normally whole pounds — do you want to save this exact price anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>Save anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmIfNotWhole, dialog };
}
