import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CreditCard, Trash2, Plus, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "15px",
      color: "#1a1a1a",
      fontFamily: "system-ui, sans-serif",
      "::placeholder": { color: "#9ca3af" },
    },
    invalid: { color: "#ef4444" },
  },
};

function brandLabel(brand: string) {
  const map: Record<string, string> = {
    visa: "Visa", mastercard: "Mastercard", amex: "Amex",
    discover: "Discover", jcb: "JCB", unionpay: "UnionPay",
  };
  return map[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

function AddCardForm({ clientSecret, onSuccess, onCancel }: {
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setCardError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) { setSaving(false); return; }

    const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: cardElement },
    });

    if (error) {
      setCardError(error.message ?? "Card setup failed");
      setSaving(false);
    } else if (setupIntent?.status === "succeeded") {
      toast({ title: "Card saved", description: "Your card has been added successfully." });
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2 text-foreground">Card details</label>
        <div className="border rounded-md px-3 py-3 bg-background focus-within:ring-2 focus-within:ring-ring">
          <CardElement
            options={CARD_ELEMENT_OPTIONS}
            onChange={(e) => setCardError(e.error?.message ?? null)}
          />
        </div>
        {cardError && (
          <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {cardError}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !stripe}>
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
          Save card
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddCardSection({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [keyData, intentData] = await Promise.all([
          apiFetch("/portal/stripe/publishable-key"),
          apiFetch("/portal/stripe/setup-intent", { method: "POST" }),
        ]);
        if (cancelled) return;
        const s = await loadStripe(keyData.publishableKey);
        setStripeInstance(s);
        setClientSecret(intentData.clientSecret);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load card form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading card form…
      </div>
    );
  }

  if (error || !stripeInstance || !clientSecret) {
    return (
      <p className="text-sm text-destructive">{error ?? "Could not load card form. Please try again."}</p>
    );
  }

  return (
    <Elements stripe={stripeInstance} options={{ clientSecret }}>
      <AddCardForm
        clientSecret={clientSecret}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </Elements>
  );
}

export default function PaymentMethods() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error } = useQuery<{ paymentMethods: any[] }>({
    queryKey: ["portal-payment-methods"],
    queryFn: () => apiFetch("/portal/stripe/payment-methods"),
  });

  const removeMutation = useMutation({
    mutationFn: (pmId: string) =>
      apiFetch(`/portal/stripe/payment-methods/${pmId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-payment-methods"] });
      toast({ title: "Card removed" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to remove card", description: e.message, variant: "destructive" });
    },
  });

  function handleAddSuccess() {
    setShowAdd(false);
    queryClient.invalidateQueries({ queryKey: ["portal-payment-methods"] });
  }

  return (
    <PortalLayout>
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Payment Methods</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Save a card to pay instantly when placing orders.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="text-destructive text-sm py-4">
            Failed to load payment methods. Please refresh and try again.
          </div>
        )}

        {data && (
          <div className="space-y-3 mb-6">
            {data.paymentMethods.length === 0 && !showAdd && (
              <Card>
                <CardContent className="py-8 text-center">
                  <CreditCard className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No saved cards yet.</p>
                  <p className="text-muted-foreground text-xs mt-1">Add a card to pay instantly when placing orders.</p>
                </CardContent>
              </Card>
            )}

            {data.paymentMethods.map((pm: any) => (
              <Card key={pm.id}>
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-7 bg-muted rounded flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {brandLabel(pm.card?.brand ?? "")} •••• {pm.card?.last4}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Expires {pm.card?.exp_month?.toString().padStart(2, "0")}/{pm.card?.exp_year}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeMutation.mutate(pm.id)}
                    disabled={removeMutation.isPending && removeMutation.variables === pm.id}
                  >
                    {removeMutation.isPending && removeMutation.variables === pm.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    <span className="ml-1.5">Remove</span>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showAdd ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add new card</CardTitle>
              <CardDescription>Your card details are handled securely by Stripe and never stored on our servers.</CardDescription>
            </CardHeader>
            <CardContent>
              <AddCardSection onSuccess={handleAddSuccess} onCancel={() => setShowAdd(false)} />
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setShowAdd(true)} variant="outline">
            <Plus className="w-4 h-4 mr-1.5" /> Add card
          </Button>
        )}
      </div>
    </PortalLayout>
  );
}
