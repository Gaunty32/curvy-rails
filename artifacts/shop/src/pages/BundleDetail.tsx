import { useState, useEffect, useMemo } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useQuery } from '@tanstack/react-query';
import { proxyImageUrl } from '@/lib/imageProxy';
import { useParams, Link } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import { useBrandingOptions } from '@/hooks/use-wc';
import type { BrandingPosition, BundleComponentSelection } from '@/context/CartContext';
import { useVAT } from '@/context/VATContext';
import { CheckCircle2, Package, Tag, ArrowLeft, ShoppingCart, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { LogoBrandingSection, LogoUploadSection } from '@/components/LogoBrandingSection';
import { KitDesignerText } from '@/components/KitDesignerText';

// ── Colour helpers ─────────────────────────────────────────────────────────────

const COLOUR_CSS: Record<string, string> = {
  // Blacks / whites / greys
  'Black':'#1a1a1a','White':'#f8f8f8','Charcoal':'#36454f','Graphite':'#474b4e',
  'Graphite Grey':'#474b4e','Grey':'#7d7d7d','Gray':'#7d7d7d','Silver':'#a8a9ad',
  'Metal Grey':'#a2a2a2','Light Grey':'#c8c8c8','Light Gray':'#c8c8c8',
  'Heather Grey':'#9b9ea4','Ash':'#b2b2b2',
  // Blues
  'Navy':'#001f5b','Navy Blue':'#001f5b','Royal':'#4169e1','Royal Blue':'#4169e1',
  'Sky':'#87ceeb','Sky Blue':'#87ceeb','Baby Blue':'#a8d5ea','Mid Blue':'#4a7fc1',
  'Cobalt':'#0047ab','Sapphire':'#0f52ba','Surf Blue':'#4a9aba',
  'Hospital Blue':'#b0c4de','Cornflower Blue':'#6495ed','Hawaiian Blue':'#1ca9c9',
  'Airforce Blue':'#5d8aa8','Metro Blue':'#007bc0','Indigo':'#4b0082',
  'Aqua':'#00bcd4','Turquoise':'#40e0d0','Teal':'#008080',
  // Greens
  'Green':'#2e7d32','Bottle':'#004d2c','Bottle Green':'#004d2c',
  'Forest':'#228b22','Forest Green':'#228b22','Lime':'#32cd32','Lime Green':'#32cd32',
  'Kelly Green':'#4cbb17','Emerald':'#50c878','Jade':'#00a86b','Sage':'#bcb88a',
  'Olive':'#6b7c3e','Olive Green':'#6b7c3e','Moss Green':'#8a9a5b',
  'Military Green':'#4b5320','Electric Green':'#00dd00','Earth Green':'#3b5323',
  'Combat Green':'#4b5320','Sour Green':'#9acd32','Mint Green':'#98ff98',
  // Reds / pinks / purples
  'Red':'#cc1111','Bright Red':'#e60000','Scarlet':'#ff2400',
  'Burgundy':'#6d1a2c','Maroon':'#6d0015','Orange':'#e86830',
  'Fluorescent Orange':'#ff6600','Electric Orange':'#ff5500',
  'Pink':'#e8769e','Hot Pink':'#ff69b4','Baby Pink':'#f4a7b9',
  'Dusty Pink':'#d4a0a0','Hyper Pink':'#ff2f92','Electric Pink':'#ff44cc',
  'Fuchsia':'#c8175d','Fluorescent Pink':'#ff1493','Magenta':'#c8175d',
  'Purple':'#6a0dad','Violet':'#7f00ff','Lilac':'#c8a2c8',
  'Lavender':'#e6e6fa','Aubergine':'#614051',
  // Yellows / golds
  'Yellow':'#f5c800','Lemon':'#fff44f','Sunflower':'#ffc512',
  'Mustard':'#ffdb58','Gold':'#d4a017','Fluorescent Yellow':'#ccff00',
  'Electric Yellow':'#ffff00','Citrus':'#dfcc00',
  // Neutrals / browns
  'Stone':'#b5a695','Sand':'#c2b280','Khaki':'#c3b091','Beige':'#e8dcc8',
  'Cream':'#fffdd0','Ivory':'#fffff0','Wheat':'#f5deb3','Natural':'#f5f0e8',
  'Ecru':'#c2b280','Brown':'#7b3f00','Chocolate':'#5a2d0c','Hot Chocolate':'#3c1a0e',
  'Tan':'#d2b48c','Caramel':'#af6f09','Copper':'#b87333','Terracotta':'#c66b3d',
  'Coral':'#ff7f50','Peach':'#ffcba4','Desert Sand':'#e1c49a',
  // Denim tones
  'Black Denim':'#1c1f2e','Indigo Denim':'#3c4a6e','Charcoal Denim':'#2a3040',
};

function isLight(hex: string) {
  const c = hex.replace('#', '');
  return (parseInt(c.slice(0,2),16)*299+parseInt(c.slice(2,4),16)*587+parseInt(c.slice(4,6),16)*114)/1000>170;
}

function resolveColourCss(colour: string): string | null {
  if (COLOUR_CSS[colour]) return COLOUR_CSS[colour];
  // Dual-colour: "Black/Red", "Navy/Royal", etc.
  if (colour.includes('/')) {
    const parts = colour.split('/').map(p => p.trim());
    const a = COLOUR_CSS[parts[0]], b = COLOUR_CSS[parts[1]];
    if (a && b) return `linear-gradient(135deg, ${a} 50%, ${b} 50%)`;
    if (a) return a;
    if (b) return b;
  }
  // Strip pattern suffix: "Navy Check" → "Navy"
  const SUFFIXES = ['check','checks','herringbone','denim','stripe','stripes'];
  const words = colour.split(' ');
  if (words.length > 1 && SUFFIXES.includes(words[words.length - 1].toLowerCase())) {
    const base = words.slice(0, -1).join(' ');
    if (COLOUR_CSS[base]) return COLOUR_CSS[base];
  }
  return null;
}

function ColourSwatch({ colour, selected, onClick }: { colour: string; selected: boolean; onClick: () => void }) {
  const bg = resolveColourCss(colour);
  const firstHex = bg?.startsWith('linear-gradient')
    ? (COLOUR_CSS[colour.split('/')[0]?.trim()] ?? '#888') : (bg ?? '#888');
  const light = bg ? isLight(firstHex) : false;
  if (!bg) {
    return (
      <button
        onClick={onClick}
        className={`px-3 py-1.5 text-xs border-2 rounded-full font-medium transition-all ${
          selected ? 'border-primary bg-primary text-white' : 'border-gray-300 text-gray-700 hover:border-primary bg-white'
        }`}
      >{colour}</button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={colour}
      aria-label={colour}
      className={`relative w-8 h-8 rounded-full transition-all flex items-center justify-center ${
        selected ? 'ring-2 ring-primary ring-offset-2' : 'hover:ring-2 hover:ring-gray-400 hover:ring-offset-1'
      }`}
      style={{ background: bg, border: light ? '1.5px solid #c8c8c8' : '1.5px solid transparent' }}
    >
      {selected && (
        <span className="text-xs font-black" style={{ color: light ? '#333' : '#fff', textShadow: light ? 'none' : '0 1px 2px rgba(0,0,0,.4)' }}>✓</span>
      )}
    </button>
  );
}

function SizePill({ option, selected, onClick }: { option: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm border-2 rounded-full font-medium min-w-[2.75rem] text-center transition-all ${
        selected ? 'border-primary bg-primary text-white' : 'border-gray-300 text-gray-700 hover:border-primary bg-white'
      }`}
    >{option}</button>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentProduct {
  id: number;
  name: string;
  slug: string;
  imageUrl: string | null;
  description: string | null;
  colours: string[];
  sizes: string[];
  sleeves: string[];
  colourImages: Record<string, string>;
  variations: { id: number; colour: string | null; size: string | null; sleeve: string | null; imageUrl: string | null; sku: string | null }[];
}

interface BundleComponent {
  qty: number;
  name: string;
  product: ComponentProduct | null;
}

interface BundleData {
  bundle: {
    id: number; name: string; slug: string; sku: string | null;
    price: string; regularPrice: string | null; onSale: boolean;
    imageUrl: string | null; images: string[];
  };
  components: BundleComponent[];
}

interface ComponentSel { colour?: string; size?: string; sleeve?: string; }

// ── Per-component card ────────────────────────────────────────────────────────

function ComponentCard({
  component,
  index,
  selection,
  onSelect,
  hasError,
  brandingOptions,
  brandingSelection,
  onBrandingToggle,
}: {
  component: BundleComponent;
  index: number;
  selection: ComponentSel;
  onSelect: (field: 'colour' | 'size' | 'sleeve', value: string) => void;
  hasError: boolean;
  brandingOptions: BrandingPosition[];
  brandingSelection: BrandingPosition[];
  onBrandingToggle: (pos: BrandingPosition) => void;
}) {
  const { vatPrice, vatLabel } = useVAT();
  const p = component.product;
  const [descOpen, setDescOpen] = useState(true);

  const displayImage = useMemo(() => {
    if (!p) return null;
    const colourImg = selection.colour ? p.colourImages[selection.colour] : null;
    return colourImg ?? p.imageUrl;
  }, [p, selection.colour]);
  const proxiedDisplayImage = displayImage ? proxyImageUrl(displayImage) : null;

  const availableSizes = useMemo(() => {
    if (!p || !p.variations.length) return p?.sizes ?? [];
    if (!selection.colour) return p.sizes;
    const fromVars = p.variations
      .filter(v => v.colour === selection.colour && v.size)
      .map(v => v.size as string)
      .filter((v, i, a) => a.indexOf(v) === i);
    return fromVars.length ? fromVars : p.sizes;
  }, [p, selection.colour]);

  const availableSleeves = useMemo(() => {
    if (!p || !p.variations.length) return p?.sleeves ?? [];
    const fromVars = p.variations
      .filter(v =>
        (!selection.colour || v.colour === selection.colour) &&
        (!selection.size   || v.size   === selection.size) &&
        v.sleeve
      )
      .map(v => v.sleeve as string)
      .filter((v, i, a) => a.indexOf(v) === i);
    return fromVars.length ? fromVars : p.sleeves;
  }, [p, selection.colour, selection.size]);


  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-all ${hasError ? 'border-red-400 shadow-sm shadow-red-100' : 'border-gray-200'}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <span className="w-7 h-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
          {component.qty}
        </span>
        <span className="font-semibold text-sm text-gray-900 flex-1">{p?.name ?? component.name}</span>
        {hasError && <span className="text-xs text-red-500 font-medium">Selection required</span>}
        {/* Description toggle */}
        {p?.description && (
          <button
            onClick={() => setDescOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary transition-colors ml-2 font-medium"
          >
            Product details {descOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Description accordion */}
      {p?.description && descOpen && (
        <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/40 text-sm text-gray-600 leading-relaxed">
          <KitDesignerText>{p.description}</KitDesignerText>
        </div>
      )}

      {/* Main content: image + selectors */}
      <div className="flex gap-4 p-4">
        {/* Product image */}
        <div className="w-24 h-24 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 self-start">
          {proxiedDisplayImage ? (
            <img
              src={proxiedDisplayImage}
              alt={p?.name ?? component.name}
              className="w-full h-full object-cover"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="w-8 h-8 text-gray-300" />
            </div>
          )}
        </div>

        {/* Selectors */}
        <div className="flex-1 space-y-4 min-w-0">
          {!p ? (
            <p className="text-sm text-gray-500 italic">Contact us to discuss colour and size options for this item.</p>
          ) : (
            <>
              {p.colours.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                    Colour
                    {selection.colour
                      ? <span className="font-normal normal-case ml-1 text-gray-500">{selection.colour}</span>
                      : <span className="text-red-400 ml-1">*</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.colours.map(c => (
                      <ColourSwatch key={c} colour={c} selected={selection.colour === c} onClick={() => onSelect('colour', c)} />
                    ))}
                  </div>
                </div>
              )}

              {p.sizes.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                    Size
                    {selection.size
                      ? <span className="font-normal normal-case ml-1 text-gray-500">{selection.size}</span>
                      : <span className="text-red-400 ml-1">*</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSizes.map(s => (
                      <SizePill key={s} option={s} selected={selection.size === s} onClick={() => onSelect('size', s)} />
                    ))}
                  </div>
                </div>
              )}

              {p.sleeves.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                    Length
                    {selection.sleeve
                      ? <span className="font-normal normal-case ml-1 text-gray-500">{selection.sleeve}</span>
                      : <span className="text-red-400 ml-1">*</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSleeves.map(s => (
                      <SizePill key={s} option={s} selected={selection.sleeve === s} onClick={() => onSelect('sleeve', s)} />
                    ))}
                  </div>
                </div>
              )}

              {p.colours.length === 0 && p.sizes.length === 0 && p.sleeves.length === 0 && (
                <p className="text-sm text-gray-500 italic">No options needed — our team will select appropriately.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Logo placement — per item */}
      {brandingOptions.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2.5">Logo Placement</p>
          <div className="space-y-2">
            {brandingOptions.map(pos => {
              const isSel = brandingSelection.some(p => p.id === pos.id);
              const lineCost = pos.surcharge > 0 ? pos.surcharge * component.qty : 0;
              const garmentLabel = component.qty === 1 ? (p?.name ?? component.name) : `${p?.name ?? component.name}s`;
              return (
                <div key={pos.id}>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer"
                      checked={isSel}
                      onChange={() => onBrandingToggle(pos)}
                    />
                    <span className="text-sm text-gray-700 group-hover:text-primary transition-colors">
                      {pos.name}
                      {pos.description && <span className="text-gray-400 ml-1 font-normal text-xs">— {pos.description}</span>}
                    </span>
                  </label>
                  {isSel && pos.surcharge > 0 && (
                    <p className="ml-7 mt-0.5 text-xs text-amber-700">
                      {pos.name} on {component.qty} {garmentLabel}, £{vatPrice(pos.surcharge).toFixed(2)} per garment × {component.qty} = £{vatPrice(lineCost).toFixed(2)} in total
                    </p>
                  )}
                  {isSel && pos.surcharge === 0 && (
                    <p className="ml-7 mt-0.5 text-xs text-green-700">Included free</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BundleDetail() {
  const { vatPrice, vatLabel } = useVAT();
  const { slug } = useParams<{ slug: string }>();
  const { addItem } = useCart();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<BundleData>({
    queryKey: ['bundle-components', slug],
    queryFn: () => fetch(`/api/shop/bundle-components/${slug}`).then(r => {
      if (!r.ok) throw new Error('Not found');
      return r.json();
    }),
    enabled: !!slug,
    staleTime: 300_000,
  });

  const [selections, setSelections] = useState<Record<number, ComponentSel>>({});
  const [errors, setErrors] = useState<Set<number>>(new Set());
  const [added, setAdded] = useState(false);

  // Per-component branding selections: Record<componentIndex, BrandingPosition[]>
  const [brandingSelections, setBrandingSelections] = useState<Record<number, BrandingPosition[]>>({});

  const { data: globalBrandingOptions = [] } = useBrandingOptions();
  const brandingOpts = globalBrandingOptions as BrandingPosition[];

  // Filter out "Logo Application" pseudo-components — branding is handled
  // via the per-product logo placement checkboxes on each component card.
  const components = (data?.components ?? []).filter(
    c => !/logo\s+application/i.test(c.product?.name ?? c.name)
  );

  // Pre-select free positions for each component once options load
  useEffect(() => {
    if (brandingOpts.length === 0 || components.length === 0) return;
    setBrandingSelections(prev => {
      const next: Record<number, BrandingPosition[]> = { ...prev };
      components.forEach((_, idx) => {
        if (!next[idx]) {
          next[idx] = brandingOpts.filter(p => p.surcharge === 0 && !p.notes_field);
        }
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandingOpts.length, components.length]);

  const bundle = data?.bundle;
  const bundleImage = bundle?.imageUrl ? proxyImageUrl(bundle.imageUrl) : null;
  const bundlePrice = bundle ? Number(bundle.price) : 0;
  const regularPrice = bundle?.regularPrice ? Number(bundle.regularPrice) : null;
  const onSale = !!(regularPrice && regularPrice > bundlePrice);

  // Total branding surcharge = Σ over components of (comp.qty × Σ pos.surcharge)
  const totalBrandingSurcharge = useMemo(() =>
    components.reduce((total, comp, idx) => {
      const compBranding = brandingSelections[idx] ?? [];
      const compSurcharge = compBranding.reduce((s, p) => s + p.surcharge, 0);
      return total + compSurcharge * comp.qty;
    }, 0),
    [components, brandingSelections]
  );

  const grandTotal = bundlePrice + totalBrandingSurcharge;

  useSEO({
    title: bundle ? `${bundle.name} — Bundle Pack` : 'Bundle Pack',
    description: 'Pre-matched workwear bundle with free logo application. Save more vs buying separately.',
  });

  function getVariationId(comp: BundleComponent, sel: ComponentSel): number | null {
    if (!comp.product) return null;
    const match = comp.product.variations.find(v =>
      (!v.colour || v.colour === sel.colour) &&
      (!v.size   || v.size   === sel.size) &&
      (!v.sleeve || v.sleeve === sel.sleeve)
    );
    return match?.id ?? null;
  }

  function handleAddToCart() {
    if (!bundle || !data) return;

    const newErrors = new Set<number>();
    components.forEach((comp, idx) => {
      if (!comp.product) return;
      if (comp.product.colours.length > 0 && !selections[idx]?.colour) newErrors.add(idx);
      if (comp.product.sizes.length > 0   && !selections[idx]?.size)   newErrors.add(idx);
      if (comp.product.sleeves.length > 0  && !selections[idx]?.sleeve) newErrors.add(idx);
    });

    if (newErrors.size > 0) {
      setErrors(newErrors);
      toast({ title: 'Please complete all selections', description: 'Each item needs a colour and size.', variant: 'destructive' });
      document.querySelector('[data-bundle-error]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setErrors(new Set());

    const bundleComponents: BundleComponentSelection[] = components.map((comp, idx) => {
      const sel = selections[idx] ?? {};
      return {
        name: comp.product?.name ?? comp.name,
        qty: comp.qty,
        colour: sel.colour ?? null,
        size: sel.size ?? null,
        sleeve: sel.sleeve ?? null,
        variationId: getVariationId(comp, sel),
        brandingPositions: brandingSelections[idx] ?? [],
      };
    });

    addItem({
      wcProductId: bundle.id,
      name: bundle.name,
      sku: bundle.sku ?? null,
      price: grandTotal,
      quantity: 1,
      image: bundle.imageUrl,
      bundleComponents,
    });

    setAdded(true);
    toast({ title: 'Bundle added to cart!', description: `${bundle.name} — all ${components.length} items configured.` });
    setTimeout(() => setAdded(false), 3000);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <>
        <div className="min-h-screen bg-gray-50">
          <div className="bg-white border-b"><div className="container mx-auto px-4 py-3"><Skeleton className="h-4 w-40" /></div></div>
          <div className="container mx-auto px-4 py-10 max-w-5xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
              <Skeleton className="aspect-square rounded-xl w-full" />
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4" /><Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-4 w-full" /><Skeleton className="h-32 w-full" />
              </div>
            </div>
            {[1,2,3].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl mb-4" />)}
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">Bundle not found</p>
          <Link href="/bulk-buy-bundles" className="mt-3 inline-block text-sm text-primary underline">Back to bundles</Link>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <Link href="/bulk-buy-bundles" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Bulk Buy &amp; Bundles
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-5xl">
        {/* ── Bundle header ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start mb-12">
          {/* Image */}
          <div className="rounded-xl overflow-hidden bg-white shadow-sm border border-gray-100 aspect-square relative">
            {onSale && (
              <span className="absolute top-3 right-3 z-10 bg-accent text-white text-xs font-bold px-3 py-1 uppercase rounded-sm shadow">Sale</span>
            )}
            {bundleImage ? (
              <img src={bundleImage} alt={bundle!.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300"><Package className="w-20 h-20" /></div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col gap-4">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-accent">
              <Tag className="w-3.5 h-3.5" /> Bundle Pack — Free Logo Application Included
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 leading-tight">{bundle!.name}</h1>

            {/* Price block */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-extrabold text-primary">£{vatPrice(grandTotal).toFixed(2)}</span>
                {onSale && regularPrice && <span className="text-lg text-gray-400 line-through">£{vatPrice(regularPrice).toFixed(2)}</span>}
                <span className="text-sm text-gray-500">{vatLabel}</span>
              </div>
              {totalBrandingSurcharge > 0 && (
                <div className="text-xs text-gray-500 border-t border-gray-100 pt-2 space-y-0.5">
                  <div className="flex justify-between"><span>Bundle price</span><span className="font-medium text-gray-700">£{vatPrice(bundlePrice).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Logo additions</span><span className="font-medium text-gray-700">+£{vatPrice(totalBrandingSurcharge).toFixed(2)}</span></div>
                </div>
              )}
              {onSale && regularPrice && (
                <p className="text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  💰 Save £{vatPrice(regularPrice - bundlePrice).toFixed(2)} — approx. {Math.round((1 - bundlePrice / regularPrice) * 100)}% off vs buying separately
                </p>
              )}
            </div>

            {/* What's in the pack */}
            {components.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="bg-primary/5 border-b border-gray-200 px-4 py-2.5">
                  <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" /> What's in the Pack
                  </h2>
                </div>
                <ul className="divide-y divide-gray-100">
                  {components.map((c, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{c.qty}</span>
                      <span className="text-sm text-gray-700">{c.product?.name ?? c.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* ── Configure each item ── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-px bg-gray-200" />
            <h2 className="text-base font-bold text-gray-800 uppercase tracking-wide whitespace-nowrap">Configure Your Bundle</h2>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <p className="text-sm text-gray-500 mb-6 text-center">
            Select a colour and size for each item. Choose logo positions below each garment.
          </p>

          <div className="space-y-4">
            {components.map((comp, idx) => (
              <div key={idx} {...(errors.has(idx) ? { 'data-bundle-error': '' } : {})}>
                <ComponentCard
                  component={comp}
                  index={idx}
                  selection={selections[idx] ?? {}}
                  hasError={errors.has(idx)}
                  brandingOptions={brandingOpts}
                  brandingSelection={brandingSelections[idx] ?? []}
                  onBrandingToggle={(pos) => {
                    setBrandingSelections(prev => {
                      const cur = prev[idx] ?? [];
                      const next = cur.some(p => p.id === pos.id)
                        ? cur.filter(p => p.id !== pos.id)
                        : [...cur, pos];
                      return { ...prev, [idx]: next };
                    });
                  }}
                  onSelect={(field, value) => {
                    setSelections(prev => ({ ...prev, [idx]: { ...prev[idx], [field]: value } }));
                    if (errors.has(idx)) {
                      setErrors(prev => { const s = new Set(prev); s.delete(idx); return s; });
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Validation summary */}
        {errors.size > 0 && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Please select a colour and size for each item highlighted above.
          </div>
        )}

        {/* ── Order summary + CTA ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-gray-700 uppercase tracking-wide">Order Summary</span>
          </div>
          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex justify-between text-gray-600">
              <span>Bundle ({components.length} product lines)</span>
              <span className="font-medium text-gray-800">£{vatPrice(bundlePrice).toFixed(2)}</span>
            </div>
            {totalBrandingSurcharge > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Logo additions</span>
                <span className="font-medium text-gray-800">+£{vatPrice(totalBrandingSurcharge).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-100 pt-2 mt-2">
              <span>Total ({vatLabel})</span>
              <span className="text-primary text-lg">£{vatPrice(grandTotal).toFixed(2)}</span>
            </div>
            {onSale && regularPrice && (
              <p className="text-xs text-green-700 font-semibold text-right">
                You save £{vatPrice(regularPrice - bundlePrice).toFixed(2)} vs individual prices
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" className="flex-1 gap-2" onClick={handleAddToCart} disabled={added}>
              {added
                ? <><CheckCircle2 className="w-5 h-5" /> Bundle Added to Cart</>
                : <><ShoppingCart className="w-5 h-5" /> Add Bundle to Cart</>
              }
            </Button>
            <Button size="lg" variant="outline" className="sm:w-40" asChild>
              <a href="/contact">Get a Quote</a>
            </Button>
          </div>

          <div className="mt-4">
            <LogoUploadSection />
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center">
          Bundle covers all {components.length} garment lines listed. Free logo application on every garment.
        </p>
      </div>

      <LogoBrandingSection />
    </div>
    <Toaster />
    </>
  );
}
