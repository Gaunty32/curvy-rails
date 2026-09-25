import { Link, useLocation } from 'wouter';
import { Search, ShoppingBag } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useVAT } from '@/context/VATContext';
import { useShopSettings } from '@/hooks/use-wc';
import { usePublicConfig } from '@/lib/publicConfig';
import { useState, useEffect, useRef } from 'react';

export function Header() {
  const { data: settings } = useShopSettings({ defer: true });
  const { data: config } = usePublicConfig();
  const { itemCount, subtotal } = useCart();
  const { vatPrice, vatLabel, toggleVAT, showIncVAT } = useVAT();
  const [location, setLocation] = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise input from URL so it's pre-filled when landing on a search results page
  const urlSearch = new URLSearchParams(window.location.search).get('search') || '';
  const [search, setSearch] = useState(urlSearch);

  // Keep input in sync if URL changes externally (e.g. browser back/forward)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('search') || '');
  }, [location]);

  const navigate = (value: string) => {
    if (value.trim()) {
      setLocation(`/products?search=${encodeURIComponent(value.trim())}`);
    } else {
      // Clear search — go back to plain products listing
      setLocation('/products');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(value), 350);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(search);
  };

  return (
    <header className="bg-white py-3 md:py-6 border-b border-border shadow-sm">
      <div className="container mx-auto px-4">
        {/* Top Row: Logo, Actions */}
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="block shrink-0">
            {config?.logoUrl ? <img src={config.logoUrl} alt={config.businessName || config.tradingName || 'Business logo'} width={180} height={64} className="h-10 md:h-16 w-auto transition-transform active:scale-95" fetchPriority="high" /> : <span className="font-bold text-primary">{config?.businessName || config?.tradingName || 'Business setup required'}</span>}
          </Link>

          {/* Search (Desktop) */}
          <div className="hidden md:block flex-1 max-w-xl w-full mx-6">
            <form onSubmit={handleSearch} className="flex w-full relative">
              <input
                type="text"
                placeholder="Search for products"
                className="w-full border-2 border-gray-200 rounded-l-md px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
                value={search}
                onChange={handleChange}
              />
              <button type="submit" className="px-5 bg-primary text-white rounded-r-md hover:bg-primary/90 transition-colors flex items-center justify-center">
                <Search className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* VAT toggle */}
            <button
              onClick={toggleVAT}
              className="flex items-center gap-0 rounded-full border-2 border-gray-200 overflow-hidden text-[10px] md:text-xs font-semibold shrink-0"
              title="Toggle VAT display"
            >
              <span className={`px-2 md:px-2.5 py-1 md:py-1.5 transition-colors ${!showIncVAT ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                Ex. VAT
              </span>
              <span className={`px-2 md:px-2.5 py-1 md:py-1.5 transition-colors ${showIncVAT ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                Inc. VAT
              </span>
            </button>

            {/* Basket */}
            <Link href="/cart" className="flex items-center gap-2 md:gap-3 group">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-bold text-primary group-hover:text-accent transition-colors">£{vatPrice(subtotal).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground font-medium">{itemCount} items</div>
              </div>
              <div className="bg-primary text-white p-2.5 md:p-3 rounded-full md:rounded-none group-hover:bg-accent transition-colors relative">
                <ShoppingBag className="w-5 h-5" />
                <span className="sm:hidden absolute -top-1 -right-1 bg-accent text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                  {itemCount}
                </span>
              </div>
            </Link>
          </div>
        </div>

        {/* Search (Mobile) */}
        <div className="md:hidden mt-3">
          <form onSubmit={handleSearch} className="flex w-full relative">
            <input
              type="text"
              placeholder="Search products..."
              className="w-full border-2 border-gray-200 rounded-l-md px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors bg-gray-50"
              value={search}
              onChange={handleChange}
            />
            <button type="submit" className="px-4 bg-primary text-white rounded-r-md hover:bg-primary/90 transition-colors flex items-center justify-center active:bg-primary/80">
              <Search className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
