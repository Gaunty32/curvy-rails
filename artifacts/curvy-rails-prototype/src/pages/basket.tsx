import { useState } from 'react';
import { Link } from 'wouter';
import { Trash2 } from 'lucide-react';
import { usePageHead } from '@/lib/use-page-head';
import { asset, gbp } from '@/data/catalogue';
import { useBasket } from '@/data/basket';
import { FREE_DELIVERY_OVER, type DeliveryRegion } from '@/data/delivery';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function BasketPage() {
  usePageHead('Basket', 'VAT-inclusive prices. UK mainland delivery £3.99, free over £50. Shipping elsewhere quoted separately. Checkout is simulated.');
  const b = useBasket();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const toGo = (FREE_DELIVERY_OVER * 100 + 1 - Math.round(b.subtotal * 100)) / 100;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <h1 className="font-display text-4xl uppercase md:text-6xl">Basket</h1>
      {done && <p data-testid="text-demo-complete" className="mt-4 border border-black p-4 text-sm font-semibold">{done}</p>}
      {b.lines.length === 0 ? (
        <div data-testid="text-basket-empty" className="mt-8 border border-dashed border-black p-12 text-center">
          <p className="font-display text-2xl uppercase">Your basket is empty</p>
          <Link href="/shop" className="mt-4 inline-block bg-black px-6 py-3 text-xs font-bold uppercase tracking-widest text-white">Shop the collection</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 md:mt-8 md:grid-cols-[1.6fr_1fr] md:gap-10">
          <ul className="divide-y border-y">
            {b.lines.map((l) => (
              <li key={`${l.product.id}-${l.size}`} data-testid={`row-basket-${l.product.id}-${l.size}`} className="flex gap-3 py-4 sm:gap-4">
                <img src={asset(l.product.image)} alt="" loading="lazy" className="h-20 w-20 shrink-0 object-cover sm:h-24 sm:w-24" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link href={`/products/${l.product.slug}`} className="text-sm font-bold">{l.product.name}</Link>
                  <p className="text-xs text-muted-foreground">Size {l.size} &middot; {gbp(l.product.price)}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <div className="flex h-11 items-center border border-black text-sm">
                      <button aria-label="Fewer" className="h-full w-11" onClick={() => b.setQty(l.product.id, l.size, l.qty - 1)}>-</button>
                      <span className="w-6 text-center" data-testid={`text-line-qty-${l.product.id}-${l.size}`}>{l.qty}</span>
                      <button aria-label="More" className="h-full w-11" onClick={() => b.setQty(l.product.id, l.size, l.qty + 1)}>+</button>
                    </div>
                    <button data-testid={`button-remove-${l.product.id}-${l.size}`} aria-label={`Remove ${l.product.name} size ${l.size}`} className="flex h-11 w-11 items-center justify-center" onClick={() => b.remove(l.product.id, l.size)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="text-sm font-bold">{gbp(l.product.price * l.qty)}</p>
              </li>
            ))}
          </ul>
          <aside className="h-fit border border-black bg-white p-5 md:sticky md:top-24 md:p-6">
            <h2 className="font-display text-xl uppercase">Summary</h2>
            <label htmlFor="delivery-region" className="mt-4 block text-sm font-semibold">Delivery destination</label>
            <select id="delivery-region" data-testid="select-delivery-region" value={b.region} onChange={(e) => b.setRegion(e.target.value as DeliveryRegion)} className="mt-2 h-12 w-full border border-black bg-white px-3 text-base">
              <option value="mainland">UK mainland</option>
              <option value="outside-mainland">Outside UK mainland</option>
            </select>
            <dl aria-live="polite" className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd data-testid="text-subtotal">{gbp(b.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt>{b.region === 'mainland' ? 'UK mainland delivery' : 'Delivery'}</dt><dd data-testid="text-delivery" className="text-right">{b.delivery === null ? 'To be confirmed' : b.delivery === 0 ? 'Free' : gbp(b.delivery)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold"><dt>{b.quoteRequired ? 'Products total' : 'Total'}</dt><dd data-testid="text-total">{gbp(b.total ?? b.subtotal)}</dd></div>
            </dl>
            <p data-testid="text-vat-notice" className="mt-2 text-xs text-muted-foreground">All prices include VAT, including delivery.</p>
            {b.quoteRequired
              ? <p data-testid="text-shipping-quote" className="mt-3 border border-black p-3 text-sm">You can still place an order. An additional shipping charge will be confirmed separately, even on orders over £50. The products total above excludes that charge.</p>
              : toGo > 0 && <p className="mt-3 text-xs">Add {gbp(toGo)} more for free UK mainland delivery. Product subtotal must be over £50.</p>}
            <button data-testid="button-checkout" onClick={() => setOpen(true)} className="mt-5 h-12 w-full bg-black text-xs font-bold uppercase tracking-widest text-white">Simulated checkout</button>
            <p className="mt-2 text-[11px] text-muted-foreground">Demo only. No card details are collected.</p>
          </aside>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display uppercase">Simulated checkout</DialogTitle>
            <DialogDescription>This is a demonstration. There is no payment form, no account and no order system behind it yet. No payments, fulfilment or emails are triggered.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Destination: <strong>{b.region === 'mainland' ? 'UK mainland' : 'Outside UK mainland'}</strong></p>
          {b.quoteRequired
            ? <p data-testid="text-checkout-quote" className="text-sm">Products total: <strong>{gbp(b.subtotal)} including VAT</strong>. Additional shipping will be quoted separately; the final total is not yet confirmed. Your order can proceed pending that quote. This demo does not send a quote request.</p>
            : <p className="text-sm">Total including delivery and VAT: <strong>{gbp(b.total ?? 0)}</strong></p>}
          <button data-testid="button-complete-demo" className="h-11 bg-black text-xs font-bold uppercase tracking-widest text-white" onClick={() => {
            setDone(`Demo checkout complete.${b.quoteRequired ? ' Outside-mainland shipping would require a separate quote before confirming the final total.' : ''} This was a simulation: no order was created, no payment was taken and nothing was sent anywhere.`);
            b.clear(); setOpen(false);
          }}>{b.quoteRequired ? 'Complete demo — shipping quote pending' : 'Complete demo order'}</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
