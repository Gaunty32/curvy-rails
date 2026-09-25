import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { track } from '@/lib/analytics';

export interface BrandingPosition {
  id: string;
  name: string;
  surcharge: number;
  description?: string;
  notes_field?: boolean;
  notes?: string;
}

export interface BundleComponentSelection {
  name: string;
  qty: number;
  colour?: string | null;
  size?: string | null;
  sleeve?: string | null;
  variationId?: number | null;
  brandingPositions?: BrandingPosition[];
}

export interface CartItem {
  wcProductId: number;
  variationId?: number | null;
  name: string;
  sku?: string | null;
  price: number;
  /** Prevent product-wide quantity breaks from replacing an exact variant price. */
  priceLocked?: boolean;
  /** Effective VAT rate captured from the selected variant. */
  vatRate?: number;
  quantity: number;
  image?: string | null;
  colour?: string | null;
  size?: string | null;
  brandingPositions?: BrandingPosition[];
  wearerName?: string | null;
  /** Set for bundle products — carries per-component colour/size selections */
  bundleComponents?: BundleComponentSelection[];
}

export interface LogoUpload {
  name: string;
  url: string;
  /** Whether this was uploaded for this basket or selected from the customer's account. */
  source?: 'upload' | 'on_file';
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (index: number) => void;
  updateQuantity: (index: number, qty: number) => void;
  updateWearerName: (index: number, name: string) => void;
  repriceProduct: (wcProductId: number, newUnitPrice: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
  logoUpload: LogoUpload | null;
  setLogoUpload: (upload: LogoUpload | null) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const stored = localStorage.getItem('sbs_cart');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [logoUpload, setLogoUploadState] = useState<LogoUpload | null>(() => {
    try {
      const stored = localStorage.getItem('sbs_logo_upload');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  // Discard promotion state written by older installations. Promotions are
  // intentionally unavailable until a new installation configures them.
  useEffect(() => {
    localStorage.removeItem('sbs_promotion_code');
    localStorage.removeItem('sbs_promotion_benefit');
  }, []);

  const setLogoUpload = (upload: LogoUpload | null) => {
    setLogoUploadState(upload);
    try {
      if (upload) localStorage.setItem('sbs_logo_upload', JSON.stringify(upload));
      else localStorage.removeItem('sbs_logo_upload');
    } catch {}
  };

  useEffect(() => {
    localStorage.setItem('sbs_cart', JSON.stringify(items));
  }, [items]);

  const addItem = (item: CartItem) => {
    track('ADD_TO_BASKET', { productId: String(item.wcProductId), quantity: item.quantity });
    setItems((prev) => {
      // Match on product + variation + colour + size + branding + wearer name
      const posKey = (positions: BrandingPosition[] | undefined) =>
        JSON.stringify((positions ?? []).map((p) => p.id).sort());
      const componentKey = (components: BundleComponentSelection[] | undefined) =>
        JSON.stringify((components ?? []).map(c => ({
          name: c.name, qty: c.qty, colour: c.colour ?? null, size: c.size ?? null,
          sleeve: c.sleeve ?? null, variationId: c.variationId ?? null,
          branding: (c.brandingPositions ?? []).map(p => ({ id: p.id, surcharge: p.surcharge })).sort((a, b) => a.id.localeCompare(b.id)),
        })).sort((a, b) => `${a.name}:${a.qty}`.localeCompare(`${b.name}:${b.qty}`)));
      const normalName = (n: string | null | undefined) => (n ?? '').trim().toLowerCase();
      const existingIdx = prev.findIndex(
        (i) =>
          i.wcProductId === item.wcProductId &&
          i.variationId === item.variationId &&
          i.colour === item.colour &&
          i.size === item.size &&
          posKey(i.brandingPositions) === posKey(item.brandingPositions) &&
           componentKey(i.bundleComponents) === componentKey(item.bundleComponents) &&
          normalName(i.wearerName) === normalName(item.wearerName)
      );

      if (existingIdx >= 0) {
        const newItems = [...prev];
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          quantity: newItems[existingIdx].quantity + item.quantity,
          price: item.price, // update price (tier may have changed)
        };
        return newItems;
      }
      return [...prev, item];
    });
  };

  const removeItem = (index: number) => {
    const item = items[index];
    if (item) track('REMOVE_FROM_BASKET', { productId: String(item.wcProductId), quantity: item.quantity });
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, qty: number) => {
    if (qty < 1) return;
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index].quantity = qty;
      return newItems;
    });
  };

  const updateWearerName = (index: number, name: string) => {
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], wearerName: name };
      return newItems;
    });
  };

  const repriceProduct = (wcProductId: number, newUnitPrice: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.wcProductId === wcProductId && !item.priceLocked ? { ...item, price: newUnitPrice } : item
      )
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => {
    const brandingSurcharge = i.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0;
    return sum + (i.price + brandingSurcharge) * i.quantity;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        updateWearerName,
        repriceProduct,
        clearCart,
        itemCount,
        subtotal,
        logoUpload,
        setLogoUpload,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
