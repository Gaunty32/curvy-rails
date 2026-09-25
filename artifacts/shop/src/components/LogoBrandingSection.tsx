import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { Upload, CheckCircle2, X, Scissors, Printer, LogIn, UserCheck, Palette, MessageSquare } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useShopAuth } from '@/context/ShopAuthContext';
import { LOGO_SAMPLES } from '@/lib/logoSamples';

const SCROLLING = [...LOGO_SAMPLES, ...LOGO_SAMPLES];

export function LogoUploadSection({ integratedDesign = false }: { integratedDesign?: boolean }) {
  const { logoUpload, setLogoUpload } = useCart();
  const { isLoggedIn } = useShopAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      // 1. Request presigned URL
      const res = await fetch('/api/storage/uploads/request-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error('Could not get upload URL');
      const { uploadURL, objectPath } = await res.json();

      // 2. Upload directly to GCS
      const putRes = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload failed');

      setLogoUpload({ name: file.name, url: objectPath, source: 'upload' });
    } catch (e: any) {
      setError(e.message ?? 'Upload failed — please try again or use the configured contact option.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-5">
      {isLoggedIn ? (
        <div className="mb-4 flex gap-3 rounded-xl border border-green-200 bg-green-50 p-3">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />
          <div>
            <p className="text-sm font-bold text-green-900">
              {integratedDesign ? 'Repeat design? You do not need to upload the artwork again.' : 'Repeat order? You do not need to upload your logo again.'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-green-800">
              At checkout, choose “Use my logo on file”. Staff will retrieve your approved artwork from our separate artwork system.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex gap-3">
            <LogIn className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-bold text-gray-900">{integratedDesign ? 'Ordered this design from us before?' : 'Ordered from us before?'}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-700">
                {integratedDesign
                  ? 'Do not upload the same design artwork again. At checkout, choose “Use my logo on file” and staff will retrieve your approved artwork.'
                  : 'Do not upload the same logo again. At checkout, choose “Use my logo on file” and staff will retrieve it from our separate artwork system. You can still sign in to link the order to your account.'}
              </p>
              <Link
                href="/login"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign in for a repeat order
              </Link>
              <p className="mt-2 text-[11px] text-gray-500">No old password is needed — we will email you a one-time code.</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm font-bold text-gray-800 mb-1">
        {integratedDesign ? 'Upload design artwork or a reference' : 'Upload a new logo'} <span className="font-normal text-gray-500">(optional)</span>
      </p>
      <p className="text-xs text-gray-500 mb-4">
        {integratedDesign
          ? 'Your artwork is used as part of the bespoke product design, not added afterwards as embroidery or print. Send a logo, sketch, brand guide or previous design for our team to work from.'
          : "Only use this for a new logo or updated artwork. JPEG, PNG, PDF or AI file. We'll review it before production and confirm your setup — no commitment yet."}
        {' '}JPEG, PNG, PDF or AI file.
        Use the configured contact option if you need help uploading a logo.
      </p>

      {logoUpload ? (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800 truncate">{logoUpload.name}</p>
            <p className="text-xs text-green-600">
              {integratedDesign ? "Saved — we'll use this as part of your bespoke design brief" : "Saved — we'll use this for your order"}
            </p>
          </div>
          <button
            onClick={() => { setLogoUpload(null); if (fileRef.current) fileRef.current.value = ''; }}
            className="text-green-500 hover:text-green-700 transition-colors"
            title="Remove"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.ai,.eps,.svg"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 bg-primary text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {uploading
              ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Uploading…</>
              : <><Upload className="w-4 h-4" /> {integratedDesign ? 'Choose Artwork File' : 'Choose Logo File'}</>
            }
          </button>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function LogoBrandingSection() {
  return (
    <div className="mt-10 border-t border-gray-100 pt-10">
      {/* Heading */}
      <div className="mb-6">
        <h2 className="text-xl font-extrabold text-gray-900 mb-1">How We Apply Your Logo</h2>
        <p className="text-sm text-gray-500">
          Every garment can be personalised with your branding. Choose from two professional techniques — or use both.
        </p>
      </div>

      {/* Method cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Embroidery */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Scissors className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 mb-1">Embroidery</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              Your logo is digitised into a stitch file and sewn directly into the fabric. Incredibly durable — it survives
              hundreds of washes and looks sharp on polos, fleeces, and workwear jackets.
            </p>
          </div>
        </div>

        {/* Print */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Printer className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 mb-1">Heat-Seal Print</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              Ideal for detailed artwork, photographs, or large back prints. Applied with precision heat transfer —
              great for hi-vis, softshells, and t-shirts where vivid colour matters.
            </p>
          </div>
        </div>
      </div>

      {/* Pricing note */}
      <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 mb-6 flex gap-3">
        <div className="text-2xl shrink-0">💡</div>
        <div className="text-sm text-amber-900 leading-relaxed">
          <span className="font-bold">One-off logo setup: £35 + VAT.</span> We convert your artwork into a professional
          stitch or print file. This covers the digitisation cost and a physical sample for your approval.{' '}
          <span className="font-semibold">Repeat orders are free</span> — once set up, we hold your logo on file and
          apply it to any future orders at no extra digitisation charge.
        </div>
      </div>

      {/* Logo gallery */}
      <div className="mb-6">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Branding examples</p>
        {LOGO_SAMPLES.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
            No sample artwork is displayed. Generic synthetic examples are available for test builds only.
          </p>
        ) : <div className="relative overflow-hidden -mx-4 px-0">
          <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
          <style>{`
            @keyframes logo-scroll-pd {
              0%   { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .logo-track-pd {
              display: flex;
              width: max-content;
              animation: logo-scroll-pd 30s linear infinite;
            }
            .logo-track-pd:hover { animation-play-state: paused; }
          `}</style>
          <div className="logo-track-pd">
            {SCROLLING.map((img, i) => (
              <div
                key={i}
                className="shrink-0 w-36 h-28 mx-2 border border-gray-200 bg-white flex items-center justify-center overflow-hidden rounded-xl"
              >
                <img src={img.src} alt={img.alt} loading="lazy" className="w-full h-full object-contain p-3" />
              </div>
            ))}
          </div>
        </div>}
      </div>
    </div>
  );
}

export function BespokeDesignSection() {
  return (
    <div className="mt-10 border-t border-gray-100 pt-10">
      <div className="mb-6">
        <h2 className="text-xl font-extrabold text-gray-900 mb-1">Your Branding Is Part of the Design</h2>
        <p className="text-sm text-gray-500 max-w-3xl">
          This is a fully bespoke product. Your colours, logo and other brand details are built into the product design during manufacture rather than applied afterwards.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Palette className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 mb-1">Designed Around Your Brand</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              Share your artwork, colours and ideas. Our team will use them to create the complete product design.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 mb-1">Artwork Approval Before Production</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              We will prepare the design with you and confirm the artwork before manufacturing begins.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 leading-relaxed">
        <span className="font-bold">No separate logo application is needed.</span> Do not choose an embroidery, print method or logo position for this product.
      </div>
    </div>
  );
}
