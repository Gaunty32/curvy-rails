import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useShopAuth, getShopToken, type ShopCustomer } from '@/context/ShopAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  colour: string | null;
  size: string | null;
}

interface Order {
  id: number;
  order_number: string;
  status: string;
  total_amount: string;
  order_date: string;
  items: OrderItem[];
}

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  processing:   { label: 'Processing',    colour: 'bg-blue-100 text-blue-700' },
  in_progress:  { label: 'In Progress',   colour: 'bg-amber-100 text-amber-700' },
  dispatched:   { label: 'Dispatched',    colour: 'bg-green-100 text-green-700' },
  completed:    { label: 'Completed',     colour: 'bg-green-100 text-green-700' },
  cancelled:    { label: 'Cancelled',     colour: 'bg-red-100 text-red-700' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Account() {
  const { customer, isLoggedIn, loading: authLoading, logout, refreshCustomer } = useShopAuth();
  const [, setLocation] = useLocation();

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);

  // Profile edit state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<Partial<ShopCustomer>>({});

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !isLoggedIn) setLocation('/login');
  }, [authLoading, isLoggedIn, setLocation]);

  // Load orders
  useEffect(() => {
    if (!isLoggedIn) return;
    const token = getShopToken();
    fetch('/api/shop/customer/orders', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setOrders(d.orders ?? []))
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, [isLoggedIn]);

  // Populate form when customer loads
  useEffect(() => {
    if (customer) {
      setForm({
        first_name: customer.first_name ?? '',
        last_name:  customer.last_name  ?? '',
        company:    customer.company    ?? '',
        phone:      customer.phone      ?? '',
        address_1:  customer.address_1  ?? '',
        address_2:  customer.address_2  ?? '',
        city:       customer.city       ?? '',
        county:     customer.county     ?? '',
        postcode:   customer.postcode   ?? '',
      });
    }
  }, [customer]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const token = getShopToken();
      const res = await fetch('/api/shop/customer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          firstName: form.first_name,
          lastName:  form.last_name,
          company:   form.company,
          phone:     form.phone,
          address1:  form.address_1,
          address2:  form.address_2,
          city:      form.city,
          county:    form.county,
          postcode:  form.postcode,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      await refreshCustomer();
      setEditing(false);
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-gray-500">
        Loading…
      </div>
    );
  }
  if (!customer) return null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-primary">My Account</h1>
        <Button variant="outline" size="sm" onClick={() => { logout(); setLocation('/'); }}>
          Sign out
        </Button>
      </div>

      {/* Profile section */}
      <section className="border-4 border-primary p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-primary">Account Details</h2>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>

        {!editing ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="font-semibold text-gray-600">Email</dt>
            <dd className="text-gray-900">{customer.email}</dd>
            <dt className="font-semibold text-gray-600">Name</dt>
            <dd className="text-gray-900">
              {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}
            </dd>
            {customer.company && (<>
              <dt className="font-semibold text-gray-600">Company</dt>
              <dd className="text-gray-900">{customer.company}</dd>
            </>)}
            {customer.phone && (<>
              <dt className="font-semibold text-gray-600">Phone</dt>
              <dd className="text-gray-900">{customer.phone}</dd>
            </>)}
            {customer.address_1 && (<>
              <dt className="font-semibold text-gray-600">Address</dt>
              <dd className="text-gray-900">
                {[customer.address_1, customer.address_2, customer.city, customer.county, customer.postcode]
                  .filter(Boolean).join(', ')}
              </dd>
            </>)}
          </dl>
        ) : (
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            {saveError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">{saveError}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">First name</label>
                <Input className="rounded-none" value={form.first_name ?? ''} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Last name</label>
                <Input className="rounded-none" value={form.last_name ?? ''} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Company (optional)</label>
              <Input className="rounded-none" value={form.company ?? ''} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Phone (optional)</label>
              <Input className="rounded-none" value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Address line 1</label>
              <Input className="rounded-none" value={form.address_1 ?? ''} onChange={e => setForm(f => ({ ...f, address_1: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Address line 2 (optional)</label>
              <Input className="rounded-none" value={form.address_2 ?? ''} onChange={e => setForm(f => ({ ...f, address_2: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Town / City</label>
                <Input className="rounded-none" value={form.city ?? ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Postcode</label>
                <Input className="rounded-none" value={form.postcode ?? ''} onChange={e => setForm(f => ({ ...f, postcode: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-2">
              <Button type="submit" className="rounded-none font-bold" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
              <Button type="button" variant="outline" className="rounded-none" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Orders section */}
      <section>
        <h2 className="text-xl font-bold text-primary mb-4">Order History</h2>
        {ordersLoading ? (
          <p className="text-gray-500 text-sm">Loading orders…</p>
        ) : orders.length === 0 ? (
          <div className="border border-gray-200 p-8 text-center text-gray-500">
            <p className="font-semibold mb-1">No orders yet</p>
            <p className="text-sm">Orders you place while signed in will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {orders.map(order => {
              const status = STATUS_LABELS[order.status] ?? { label: order.status, colour: 'bg-gray-100 text-gray-700' };
              const isOpen = expandedOrder === order.id;
              return (
                <div key={order.id} className="border border-gray-200">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedOrder(isOpen ? null : order.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-primary">{order.order_number}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.colour}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>{fmt(order.order_date)}</span>
                      <span className="font-bold text-gray-900">£{parseFloat(order.total_amount).toFixed(2)}</span>
                      <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="py-1 text-left text-gray-600 font-semibold">Item</th>
                            <th className="py-1 text-center text-gray-600 font-semibold">Qty</th>
                            <th className="py-1 text-right text-gray-600 font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1.5 text-gray-800">
                                {item.product_name}
                                {(item.colour || item.size) && (
                                  <span className="text-gray-500 ml-1">
                                    ({[item.colour, item.size].filter(Boolean).join(', ')})
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 text-center text-gray-700">{item.quantity}</td>
                              <td className="py-1.5 text-right font-semibold text-gray-900">
                                £{parseFloat(item.line_total).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={2} className="pt-2 font-bold text-gray-900">Order total</td>
                            <td className="pt-2 text-right font-bold text-primary">
                              £{parseFloat(order.total_amount).toFixed(2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
