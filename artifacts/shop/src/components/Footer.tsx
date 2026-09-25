import { Link } from 'wouter';
import { useShopSettings } from '@/hooks/use-wc';
import { usePublicConfig } from '@/lib/publicConfig';

export function Footer() {
  const { data: settings } = useShopSettings({ defer: true });
  const { data: config } = usePublicConfig();

  return (
    <footer className="bg-white border-t border-gray-200 py-8">
      <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-gray-500 font-medium">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
          <Link href="/about" className="hover:text-primary transition-colors">ABOUT US</Link>
          <Link href="/contact" className="hover:text-primary transition-colors">CONTACT US</Link>
          <Link href="/terms" className="hover:text-primary transition-colors">T&CS</Link>
          <Link href="/privacy" className="hover:text-primary transition-colors">PRIVACY</Link>
          <Link href="/cookie-policy" className="hover:text-primary transition-colors">COOKIE POLICY</Link>
          <a href={settings?.portalUrl || '/customer-portal/'} className="hover:text-primary transition-colors">CORPORATE PORTAL</a>
        </div>
        
        <div className="flex flex-col items-center md:items-end gap-2 text-xs text-gray-400">
          <div>&copy; {new Date().getFullYear()} {config?.businessName || config?.tradingName || 'Business setup required'}{config?.phone ? ` : ${config.phone}` : ''}</div>
          <div className="flex gap-2 opacity-50">
            {/* simple placeholders for payment icons */}
            <div className="px-2 py-1 border rounded bg-gray-50">Stripe</div>
            <div className="px-2 py-1 border rounded bg-gray-50">Visa</div>
            <div className="px-2 py-1 border rounded bg-gray-50">Mastercard</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
