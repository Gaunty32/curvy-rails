import { useRef, useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useCart, type LogoUpload } from '@/context/CartContext';
import { useShopAuth, getShopToken } from '@/context/ShopAuthContext';
import { useVAT } from '@/context/VATContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CheckCircle2, FileText, Upload, X } from 'lucide-react';
import { getAttributionContext, track } from '@/lib/analytics';

// Lazily load stripe promise outside component
let stripePromise: Promise<any> | null = null;
const getStripePromise = () => {
  if (!stripePromise) {
    stripePromise = fetch(`/api/stripe/publishable-key`)
      .then(r => r.json())
      .then(d => loadStripe(d.publishableKey));
  }
  return stripePromise;
};

type ShippingOption = {
  value: 'courier' | 'free_local' | 'warehouse_collection' | 'office_collection';
  label: string;
  price: number;
  description: string;
};

const PENDING_CHECKOUT_KEY = 'shop-pending-checkout';
type PendingCheckout = { paymentIntentId: string; body: Record<string, unknown> };
function readPendingCheckout(): PendingCheckout | null {
  try {
    const value = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return typeof parsed.paymentIntentId === 'string' && parsed.body?.paymentIntentId === parsed.paymentIntentId ? parsed : null;
  } catch { return null; }
}

const DEFAULT_SHIPPING_OPTIONS: ShippingOption[] = [
  {
    value: 'courier',
    label: 'Standard UK Delivery',
    price: 8.5,
    description: 'UK delivery — £8.50 per order',
  },
  {
    value: 'warehouse_collection',
    label: 'Warehouse Collection',
    price: 0,
    description: 'Collect from LS13 3HE',
  },
  {
    value: 'office_collection',
    label: 'Office Collection',
    price: 0,
    description: 'Collect from the configured business address',
  },
];

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [, setLocation] = useLocation();
  const { items, subtotal, clearCart, logoUpload, setLogoUpload } = useCart();
  const { vatPrice } = useVAT();
  const { customer, isLoggedIn } = useShopAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(readPendingCheckout);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const processingRef = useRef(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [shippingMethod, setShippingMethod] = useState<ShippingOption['value']>('courier');
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>(DEFAULT_SHIPPING_OPTIONS);
  const [shippingLookup, setShippingLookup] = useState<{
    loading: boolean;
    postcodeValid: boolean;
    localDeliveryDistanceMiles: number | null;
  }>({ loading: false, postcodeValid: true, localDeliveryDistanceMiles: null });
  const bespokeTieQuantity = items
    .filter(item => /^Bespoke Woven Polyester Ties?$/i.test(item.name.trim()))
    .reduce((sum, item) => sum + item.quantity, 0);
  const bespokeTieMinimumMissing = bespokeTieQuantity > 0 && bespokeTieQuantity < 25;

  useEffect(() => {
    track('BEGIN_CHECKOUT', { value: Number(subtotal.toFixed(2)), _dedupeKey: 'begin_checkout' });
  }, []); // a checkout mount is the successful transition into checkout

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    company: '',
    email: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    postcode: '',
  });

  // Pre-fill from account when logged in
  useEffect(() => {
    if (customer) {
      setFormData(prev => ({
        ...prev,
        firstName: customer.first_name  ?? prev.firstName,
        lastName:  customer.last_name   ?? prev.lastName,
        company:   customer.company     ?? prev.company,
        phone:     customer.phone       ?? prev.phone,
        address1:  customer.address_1   ?? prev.address1,
        address2:  customer.address_2   ?? prev.address2,
        city:      customer.city        ?? prev.city,
        postcode:  customer.postcode    ?? prev.postcode,
        email:     customer.email       ?? prev.email,
      }));
    }
  }, [customer]);

  const logoChoice: 'none' | 'upload' | 'on_file' =
    logoUpload?.source === 'on_file' ? 'on_file' : logoUpload ? 'upload' : 'none';

  const chooseLogo = (choice: 'none' | 'upload' | 'on_file') => {
    if (choice === 'none') {
      setLogoUpload(null);
      if (logoFileRef.current) logoFileRef.current.value = '';
    } else if (choice === 'on_file') {
      setLogoUpload({
        name: 'Existing logo held on separate artwork system',
        url: '',
        source: 'on_file',
      });
    } else if (choice === 'upload') {
      setLogoUpload(null);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  };

  const uploadCheckoutLogo = async (file: File) => {
    setLogoUpload(null);
    try {
      const token = getShopToken();
      let objectPath: string;
      if (token) {
        const response = await fetch('/api/storage/uploads/request-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        });
        if (!response.ok) {
          const details = await response.json().catch(() => null);
          throw new Error(details?.error ?? 'Could not get upload URL');
        }
        const { uploadURL, objectPath: path } = await response.json();
        const uploadResponse = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!uploadResponse.ok) throw new Error('Upload failed');
        objectPath = path;
      } else {
        const grantResponse = await fetch('/api/storage/uploads/guest-grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        });
        if (!grantResponse.ok) {
          const details = await grantResponse.json().catch(() => null);
          throw new Error(details?.error ?? 'Could not authorize checkout image upload');
        }
        const { grant } = await grantResponse.json();
        const uploadResponse = await fetch('/api/storage/uploads/guest-upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${grant}`,
            'Content-Type': file.type,
            'X-Upload-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        if (!uploadResponse.ok) {
          const details = await uploadResponse.json().catch(() => null);
          throw new Error(details?.error ?? 'Upload failed');
        }
        ({ objectPath } = await uploadResponse.json());
      }
      setLogoUpload({ name: file.name, url: objectPath, source: 'upload' });
    } catch (error: any) {
      alert(error.message ?? 'Logo upload failed — please try again or use the configured contact option.');
    }
  };

  useEffect(() => {
    const postcode = formData.postcode.trim();
    if (!postcode) {
      setShippingOptions(DEFAULT_SHIPPING_OPTIONS);
      setShippingLookup({ loading: false, postcodeValid: true, localDeliveryDistanceMiles: null });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setShippingLookup(prev => ({ ...prev, loading: true }));
      try {
        const response = await fetch(`/api/shop/shipping-options?postcode=${encodeURIComponent(postcode)}`);
        if (!response.ok) throw new Error('Unable to check delivery options');
        const data = await response.json();
        if (cancelled) return;
        setShippingOptions(data.options as ShippingOption[]);
        setShippingLookup({
          loading: false,
          postcodeValid: data.postcodeValid !== false,
          localDeliveryDistanceMiles: data.localDeliveryDistanceMiles ?? null,
        });
        const nextOptions = data.options as ShippingOption[];
        setShippingMethod(current =>
          nextOptions.some(option => option.value === current) ? current : 'courier'
        );
      } catch {
        if (cancelled) return;
        setShippingOptions(DEFAULT_SHIPPING_OPTIONS);
        setShippingLookup({ loading: false, postcodeValid: true, localDeliveryDistanceMiles: null });
        setShippingMethod(current => current === 'free_local' ? 'courier' : current);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formData.postcode]);

  const selectedShipping = shippingOptions.find(option => option.value === shippingMethod)
    ?? DEFAULT_SHIPPING_OPTIONS[0];
  const shipping = selectedShipping.price;
  // Carriage is part of the taxable supply, so VAT must be calculated after
  // adding shipping rather than adding shipping to an already VAT-inclusive subtotal.
  const vat = items.reduce((sum, item) => {
    const branding = item.brandingPositions?.reduce((value, position) => value + position.surcharge, 0) ?? 0;
    return sum + (item.price + branding) * item.quantity * (item.vatRate ?? 0.20);
  }, 0) + shipping * 0.20;
  const discountedSubtotal = subtotal;
  const discountedVat = vat;
  const total = discountedSubtotal + shipping + discountedVat;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const finishPaidOrder = async (pending: PendingCheckout) => {
    const token = getShopToken();
    const orderRes = await fetch('/api/shop/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(pending.body),
    });
    if (!orderRes.ok) {
      const details = await orderRes.json().catch(() => null);
      throw new Error(details?.error ?? 'The paid order could not be recorded. Please try finishing it again; do not pay again.');
    }
    const order = await orderRes.json();
    if (!order.orderId) throw new Error('The order response was incomplete. Please check the payment before trying again.');
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    setPendingCheckout(null);
    track('CHECKOUT_COMPLETED', { value: Number(pending.body.total), _dedupeKey: `checkout_completed:${order.orderId}` });
    clearCart();
    setLogoUpload(null);
    setLocation(`/order-complete?orderId=${order.orderId}`);
  };

  const resumeCheckout = async () => {
    if (!pendingCheckout || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setCheckoutMessage('');
    try {
      const response = await fetch(`/api/shop/stripe/payment-intent/${encodeURIComponent(pendingCheckout.paymentIntentId)}/status`);
      if (!response.ok) throw new Error('Payment status is unavailable. Please wait and try checking again.');
      const { status } = await response.json();
      if (status === 'succeeded') {
        await finishPaidOrder(pendingCheckout);
      } else if (status === 'requires_payment_method' || status === 'canceled') {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
        setPendingCheckout(null);
        setCheckoutMessage('This payment did not complete. You can try paying again.');
        if (items.length === 0) setLocation('/cart');
      } else {
        setCheckoutMessage('Your payment is still being checked. Please do not pay again; check its status shortly.');
      }
    } catch (error: any) {
      setCheckoutMessage(`${error.message} Your payment may have gone through. Do not pay again.`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processingRef.current || pendingCheckout) return;
    if (!stripe || !elements) return;
    if (bespokeTieMinimumMissing) {
      alert(`Please add ${25 - bespokeTieQuantity} more bespoke woven polyester ties. Full-length and clip-on ties count towards the same 25-unit minimum.`);
      setLocation('/cart');
      return;
    }

    if (!formData.firstName || !formData.lastName || !formData.email || !formData.address1 || !formData.city || !formData.postcode) {
      alert('Please fill in all required fields');
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    setCheckoutMessage('');
    let paymentStarted = false;
    
    try {
      // 1. Create Payment Intent
      const piRes = await fetch(`/api/shop/stripe/payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           amount: total,
           cartItems: items,
           shippingMethod,
            postcode: formData.postcode,
         })
      });
       if (!piRes.ok) {
         const paymentError = await piRes.json().catch(() => null);
         throw new Error(paymentError?.error ?? 'Failed to create payment intent');
       }
       const { clientSecret, paymentIntentId } = await piRes.json();
       const pending: PendingCheckout = {
         paymentIntentId,
         body: {
           paymentIntentId,
           customerName: `${formData.firstName} ${formData.lastName}`.trim(),
           customerEmail: formData.email,
           customerPhone: formData.phone || null,
           company: formData.company || null,
           deliveryAddress: {
             line1: formData.address1, line2: formData.address2 || null,
             city: formData.city, postcode: formData.postcode, country: 'GB',
           },
           cartItems: items,
           subtotal: discountedSubtotal,
           carriage: shipping,
           shippingMethod,
           total,
           shopCustomerId: customer?.id ?? null,
           logoUpload: logoUpload ?? null,
           logoSource: logoUpload ? (logoUpload.source ?? 'upload') : null,
           analyticsContext: getAttributionContext(),
         },
       };

      // 2. Confirm Card Payment
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
      setPendingCheckout(pending);
      paymentStarted = true;
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: `${formData.firstName} ${formData.lastName}`,
            email: formData.email,
            phone: formData.phone,
            address: {
              line1: formData.address1,
              line2: formData.address2,
              city: formData.city,
              postal_code: formData.postcode,
              country: 'GB'
            }
          }
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        await finishPaidOrder(pending);
      } else {
        setCheckoutMessage('Your payment has not finished processing. Check its status before trying to pay again.');
      }

    } catch (err: any) {
      if (paymentStarted) setCheckoutMessage(`We could not finish your order: ${err.message} Your payment may have succeeded. Do not pay again; use “Check payment and finish order” below.`);
      else setCheckoutMessage(`Checkout could not start: ${err.message}`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row gap-12">
      {/* Left: Billing Details */}
      <div className="w-full lg:w-3/5">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-primary">BILLING DETAILS</h2>
          {isLoggedIn ? (
            <span className="text-sm text-green-600 font-semibold">
              ✓ Signed in — details pre-filled
            </span>
          ) : (
            <Link href="/login" className="text-sm text-primary underline hover:no-underline">
              Repeat customer? Sign in
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">First Name *</label>
            <Input name="firstName" value={formData.firstName} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Last Name *</label>
            <Input name="lastName" value={formData.lastName} onChange={handleChange} required className="rounded-none" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Company name (optional)</label>
          <Input name="company" value={formData.company} onChange={handleChange} className="rounded-none" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Email address *</label>
            <Input type="email" name="email" value={formData.email} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Phone</label>
            <Input name="phone" value={formData.phone} onChange={handleChange} className="rounded-none" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Street address *</label>
          <Input name="address1" placeholder="House number and street name" value={formData.address1} onChange={handleChange} required className="rounded-none mb-2" />
          <Input name="address2" placeholder="Apartment, suite, unit etc. (optional)" value={formData.address2} onChange={handleChange} className="rounded-none" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Town / City *</label>
            <Input name="city" value={formData.city} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Postcode *</label>
            <Input name="postcode" value={formData.postcode} onChange={handleChange} required className="rounded-none" />
          </div>
        </div>

        {/* Logo selection */}
        <div className="mb-6 border border-gray-200 bg-white p-4">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-gray-800">Logo for this order <span className="font-normal text-gray-500">(optional)</span></h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Upload new artwork, or tell us to use your existing logo from our separate artwork system.
            </p>
          </div>

          <div className="space-y-2">
            <label className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
              logoChoice === 'upload' ? 'border-primary bg-blue-50' : 'border-gray-300 hover:border-gray-500'
            }`}>
              <input
                type="radio"
                name="checkoutLogo"
                checked={logoChoice === 'upload'}
                onChange={() => chooseLogo('upload')}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="block text-sm font-bold text-gray-900">Upload a new logo</span>
                    <span className="mt-1 block text-xs text-gray-600">JPEG, PNG, GIF or WebP (maximum 5 MiB).</span>
                {logoChoice === 'upload' && !logoUpload && (
                  <>
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) void uploadCheckoutLogo(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => logoFileRef.current?.click()}
                      className="mt-2 inline-flex items-center gap-2 bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90"
                    >
                      <Upload className="h-3.5 w-3.5" /> Choose logo file
                    </button>
                  </>
                )}
                {logoChoice === 'upload' && logoUpload && (
                  <span className="mt-2 flex items-center gap-2 text-xs font-semibold text-green-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> {logoUpload.name} uploaded
                    <button
                      type="button"
                      onClick={() => chooseLogo('upload')}
                      className="ml-1 text-gray-500 underline hover:text-gray-800"
                    >Change</button>
                  </span>
                )}
              </span>
            </label>

            <label className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
              logoChoice === 'on_file' ? 'border-primary bg-blue-50' : 'border-gray-300 hover:border-gray-500'
            }`}>
              <input
                type="radio"
                name="checkoutLogo"
                checked={logoChoice === 'on_file'}
                onChange={() => chooseLogo('on_file')}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <FileText className="h-4 w-4 text-primary" /> Use my logo on file
                </span>
                <span className="mt-1 block text-xs text-gray-600">
                  Choose this for a repeat order. Staff will retrieve your existing artwork from our separate logo system.
                </span>
                {logoChoice === 'on_file' && (
                  <span className="mt-2 flex items-center gap-2 text-xs font-semibold text-green-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> Existing logo requested
                  </span>
                )}
              </span>
            </label>

            <label className={`flex cursor-pointer items-center gap-3 border p-3 transition-colors ${
              logoChoice === 'none' ? 'border-primary bg-blue-50' : 'border-gray-300 hover:border-gray-500'
            }`}>
              <input
                type="radio"
                name="checkoutLogo"
                checked={logoChoice === 'none'}
                onChange={() => chooseLogo('none')}
                className="mt-1"
              />
              <span className="text-sm font-semibold text-gray-800">No logo for this order</span>
              {logoUpload && <X className="ml-auto h-4 w-4 text-gray-400" />}
            </label>
          </div>

        </div>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">Delivery or collection *</label>
          <div className="space-y-2">
            {shippingOptions.map(option => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
                  shippingMethod === option.value
                    ? 'border-primary bg-blue-50'
                    : 'border-gray-300 bg-white hover:border-gray-500'
                }`}
              >
                <input
                  type="radio"
                  name="shippingMethod"
                  value={option.value}
                  checked={shippingMethod === option.value}
                  onChange={() => setShippingMethod(option.value)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="flex items-center justify-between gap-3 text-sm font-bold text-gray-900">
                    <span>{option.label}</span>
                    <span>{option.price === 0 ? 'FREE' : `£${option.price.toFixed(2)}`}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">{option.description}</span>
                  {option.value === 'courier' && (
                    <span className="mt-2 block rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold leading-relaxed text-emerald-800">
                      <span className="font-extrabold uppercase tracking-wide">Buying local?</span>{' '}
                      If you are within 15 miles of LS13 3HE, we will deliver for free with our Free Local Delivery Service every Tuesday and Friday. Another benefit of buying local!
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {shippingLookup.loading && (
            <p className="mt-2 text-xs text-gray-500">Checking local delivery availability…</p>
          )}
          {!shippingLookup.loading && formData.postcode.trim() && !shippingLookup.postcodeValid && (
            <p className="mt-2 text-xs text-red-600">We couldn't verify that postcode. Please check it or choose collection.</p>
          )}
          {!shippingLookup.loading && formData.postcode.trim() && shippingLookup.postcodeValid &&
            !shippingOptions.some(option => option.value === 'free_local') && (
              <p className="mt-2 text-xs text-gray-600">
                Free Local Delivery is available within 15 miles of LS13 3HE.
              </p>
            )}
          {!shippingLookup.loading && shippingLookup.localDeliveryDistanceMiles !== null &&
            shippingOptions.some(option => option.value === 'free_local') && (
              <p className="mt-2 text-xs text-green-700">
                Your postcode is approximately {shippingLookup.localDeliveryDistanceMiles} miles from LS13 3HE.
              </p>
            )}
        </div>
      </div>

      {/* Right: Your Order */}
      <div className="w-full lg:w-2/5">
        <div className="border-4 border-primary p-6 bg-gray-50">
          <h2 className="text-xl font-bold mb-6 text-primary">YOUR ORDER</h2>
          
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="py-2 text-left text-gray-600">Product</th>
                <th className="py-2 text-right text-gray-600">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="py-3 text-gray-700">
                    {item.name} <strong className="text-gray-900">× {item.quantity}</strong>
                    {item.colour && <div className="text-xs text-gray-500">Colour: {item.colour}</div>}
                    {item.size && <div className="text-xs text-gray-500">Size: {item.size}</div>}
                    {item.bundleComponents?.map((component, componentIndex) => (
                      <div key={componentIndex} className="text-xs text-gray-500">
                        {component.qty} × {component.name}
                        {component.colour && ` · Colour: ${component.colour}`}
                        {component.size && ` · Size: ${component.size}`}
                        {component.sleeve && ` · Sleeve: ${component.sleeve}`}
                      </div>
                    ))}
                  </td>
                  <td className="py-3 text-right font-bold text-gray-900">£{(vatPrice(item.price, item.vatRate ?? 0.20) * item.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300">
              <tr>
                <td className="py-3 font-bold text-gray-900">Subtotal</td>
                <td className="py-3 text-right font-bold text-gray-900">£{discountedSubtotal.toFixed(2)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 font-bold text-gray-900">Shipping</td>
                <td className="py-3 text-right text-gray-700">
                  {selectedShipping.label}: {shipping === 0 ? 'FREE' : `£${shipping.toFixed(2)}`}
                </td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 font-bold text-gray-900">VAT</td>
                <td className="py-3 text-right text-gray-700">£{discountedVat.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="py-4 font-bold text-lg text-primary">Total</td>
                <td className="py-4 text-right font-bold text-lg text-primary">£{total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mb-6 p-4 bg-white border border-gray-300">
            <label className="block text-sm font-bold text-gray-700 mb-2">Credit Card (Stripe)</label>
            <div className="p-3 border border-gray-300 rounded-sm">
              <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
            </div>
            <p className="text-xs text-gray-500 mt-2">Pay securely using your credit or debit card.</p>
          </div>

          <Button 
            type="submit" 
            size="lg" 
            className="w-full rounded-none font-bold text-lg h-14"
            disabled={!stripe || isProcessing || !!pendingCheckout || items.length === 0 || bespokeTieMinimumMissing}
          >
            {isProcessing ? 'PROCESSING...' : 'PLACE ORDER'}
          </Button>
          {pendingCheckout && (
            <div role="alert" className="mt-4 rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
              Your payment may already have gone through. Do not place another order or pay again.
              <Button type="button" variant="outline" className="mt-3 w-full" disabled={isProcessing} onClick={resumeCheckout}>
                {isProcessing ? 'Checking payment…' : 'Check payment and finish order'}
              </Button>
            </div>
          )}
          {checkoutMessage && <p role="alert" className="mt-3 text-sm font-semibold text-amber-900">{checkoutMessage}</p>}
        </div>
      </div>
    </form>
  );
}

export default function Checkout() {
  const { items } = useCart();
  const [, setLocation] = useLocation();
  const hasPendingCheckout = !!readPendingCheckout();

  useEffect(() => {
    if (items.length === 0 && !hasPendingCheckout) {
      setLocation('/cart');
    }
  }, [items, hasPendingCheckout, setLocation]);

  if (items.length === 0 && !hasPendingCheckout) return null;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* 3-step Breadcrumb */}
      <div className="flex items-center justify-center gap-4 mb-16 text-sm sm:text-base md:text-xl font-bold">
        <span className="text-gray-400">① BASKET</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-900">② CHECKOUT DETAILS</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">③ ORDER COMPLETE</span>
      </div>

      <Elements stripe={getStripePromise()}>
        <CheckoutForm />
      </Elements>
    </div>
  );
}
