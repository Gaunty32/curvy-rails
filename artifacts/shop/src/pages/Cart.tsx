import { useCart } from '@/context/CartContext';
import { useVAT } from '@/context/VATContext';
import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Palette } from 'lucide-react';

export default function Cart() {
  const { items, removeItem, updateQuantity, updateWearerName, subtotal, logoUpload, setLogoUpload } = useCart();
  const { vatPrice, vatLabel } = useVAT();
  const effectivePrice = (item: (typeof items)[number]) =>
    item.price + (item.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0);
  const [, setLocation] = useLocation();

  const shipping = 8.50;
  // Carriage is part of the taxable supply, matching the checkout calculation.
  const vat = items.reduce((sum, item) => sum + effectivePrice(item) * item.quantity * (item.vatRate ?? 0.20), 0) + shipping * 0.20;
  const discountedSubtotal = subtotal;
  const discountedVat = vat;
  const total = discountedSubtotal + discountedVat + shipping;
  const bespokeTieQuantity = items
    .filter(item => /^Bespoke Woven Polyester Ties?$/i.test(item.name.trim()))
    .reduce((sum, item) => sum + item.quantity, 0);
  const bespokeTieMinimumMissing = bespokeTieQuantity > 0 && bespokeTieQuantity < 25;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* 3-step Breadcrumb */}
      <div className="flex items-center justify-center gap-4 mb-16 text-sm sm:text-base md:text-xl font-bold">
        <span className="text-gray-900">① BASKET</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">② CHECKOUT DETAILS</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">③ ORDER COMPLETE</span>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 mb-6 text-lg">Your basket is currently empty.</p>
          <Link href="/">
            <Button size="lg" className="rounded-none font-bold px-8">RETURN TO SHOP</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Basket Table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-4 font-bold text-gray-900"></th>
                  <th className="py-4 font-bold text-gray-900"></th>
                  <th className="py-4 font-bold text-gray-900">Product</th>
                  <th className="py-4 font-bold text-gray-900 text-center">Price</th>
                  <th className="py-4 font-bold text-gray-900 text-center">Quantity</th>
                  <th className="py-4 font-bold text-gray-900 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-6 pr-4 w-10">
                      <button 
                        onClick={() => removeItem(idx)}
                        className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-gray-400 hover:text-accent hover:border-accent transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                    <td className="py-6 w-24">
                      {item.image && <img src={item.image} alt={item.name} className="w-16 h-16 object-cover border border-gray-200" />}
                    </td>
                    <td className="py-6 min-w-[200px]">
                      <Link href={`/product/${item.wcProductId}`} className="font-bold text-primary hover:text-accent transition-colors">
                        {item.name}
                      </Link>
                      <div className="text-sm text-gray-500 mt-1">
                        {item.colour && <span>Color: {item.colour} </span>}
                        {item.size && <span>Size: {item.size}</span>}
                         {item.bundleComponents?.map((component, componentIndex) => (
                           <div key={componentIndex} className="mt-1 text-xs text-gray-500">
                             {component.qty} × {component.name}
                             {component.colour && ` · Colour: ${component.colour}`}
                             {component.size && ` · Size: ${component.size}`}
                             {component.sleeve && ` · Sleeve: ${component.sleeve}`}
                           </div>
                         ))}
                      </div>
                      {item.brandingPositions && item.brandingPositions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.brandingPositions.map(p => (
                            <span key={p.id} className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                              <Palette className="w-2.5 h-2.5" />
                              {p.name}{p.surcharge > 0 ? ` +£${p.surcharge.toFixed(2)}` : ''}
                              {p.notes_field && p.notes ? `: ${p.notes}` : ''}
                              {p.notes_field && !p.notes ? ' (TBC)' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Wearer name */}
                      <div className="flex items-center gap-1.5 mt-2">
                        <User className="w-3 h-3 text-gray-400 shrink-0" />
                        <input
                          type="text"
                          value={item.wearerName ?? ''}
                          onChange={e => updateWearerName(idx, e.target.value)}
                          placeholder="Bulk (no name)"
                          className="text-xs border-b border-dashed border-gray-300 focus:border-primary focus:outline-none bg-transparent text-gray-600 placeholder-gray-400 w-40"
                        />
                      </div>
                    </td>
                    <td className="py-6 text-center text-gray-600">
                      <div>£{vatPrice(item.price, item.vatRate ?? 0.20).toFixed(2)}</div>
                      {(item.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0) > 0 && (
                        <div className="text-xs text-amber-700 mt-0.5">
                           +£{vatPrice(item.brandingPositions!.reduce((s, p) => s + p.surcharge, 0), item.vatRate ?? 0.20).toFixed(2)} branding
                        </div>
                      )}
                    </td>
                    <td className="py-6 text-center">
                      <div className="inline-flex h-10 border border-gray-300">
                        <button 
                          onClick={() => updateQuantity(idx, item.quantity - 1)}
                          className="px-3 text-gray-500 hover:bg-gray-100"
                        >-</button>
                        <input 
                          type="number" 
                          value={item.quantity} 
                          onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 1)}
                          className="w-12 text-center focus:outline-none"
                          min="1"
                        />
                        <button 
                          onClick={() => updateQuantity(idx, item.quantity + 1)}
                          className="px-3 text-gray-500 hover:bg-gray-100"
                        >+</button>
                      </div>
                    </td>
                    <td className="py-6 text-right font-bold text-primary">
                       £{(vatPrice(effectivePrice(item), item.vatRate ?? 0.20) * item.quantity).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Basket Totals */}
          <div className="w-full lg:w-[400px]">
            {/* Logo upload status */}
            {logoUpload && (
              <div className="mb-4 flex items-center gap-3 border border-green-200 bg-green-50 rounded px-4 py-3">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-green-800">Logo uploaded</p>
                  <p className="text-xs text-green-700 truncate">{logoUpload.name}</p>
                </div>
                <button onClick={() => setLogoUpload(null)} className="text-green-500 hover:text-green-700 text-xs underline shrink-0">Remove</button>
              </div>
            )}
            <div className="border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6 uppercase tracking-wide">Basket totals</h2>
              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">Subtotal</span>
                <span className="text-gray-600">£{discountedSubtotal.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">Shipping</span>
                <div className="text-right">
                  <span className="text-gray-600 block">Flat rate: £{shipping.toFixed(2)} ex VAT</span>
                  <span className="text-xs text-gray-500">Shipping to UK.</span>
                </div>
              </div>
              <div className="border-b border-gray-100 bg-emerald-50 px-3 py-3 text-xs leading-relaxed text-emerald-800">
                <span className="font-bold">Free options may be available at checkout:</span>{' '}
                free local delivery within 15 miles of LS13 3HE on Tuesdays and Fridays, or free warehouse/office collection.
              </div>

              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">VAT</span>
                <span className="text-gray-600">£{discountedVat.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between py-6">
                <span className="font-bold text-gray-900 text-lg">Total</span>
                <span className="font-bold text-primary text-xl">£{total.toFixed(2)}</span>
              </div>

              <Button 
                size="lg" 
                className="w-full rounded-none font-bold text-base h-14"
                onClick={() => setLocation('/checkout')}
                disabled={bespokeTieMinimumMissing}
              >
                PROCEED TO CHECKOUT
              </Button>
              {bespokeTieMinimumMissing && (
                <p className="mt-3 text-sm font-semibold leading-relaxed text-red-700">
                  Add {25 - bespokeTieQuantity} more bespoke woven polyester {25 - bespokeTieQuantity === 1 ? 'tie' : 'ties'} to continue. Full-length and clip-on ties count towards the same 25-unit minimum.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
