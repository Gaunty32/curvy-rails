import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { useShopAuth } from '@/context/ShopAuthContext';
import { useShopSettings } from '@/hooks/use-wc';
import { Menu, X, ChevronDown, ChevronRight } from 'lucide-react';

export function MainNav() {
  const { data: settings } = useShopSettings({ defer: true });
  const { isLoggedIn, customer } = useShopAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ourCompanyOpen, setOurCompanyOpen] = useState(false);
  const [desktopCompanyOpen, setDesktopCompanyOpen] = useState(false);
  const [location] = useLocation();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMenuTriggerFocusRef = useRef(false);

  const closeMobileMenu = () => {
    restoreMenuTriggerFocusRef.current = true;
    setMobileMenuOpen(false);
  };

  // Close mobile menu on navigate
  useEffect(() => {
    setMobileMenuOpen(false);
    setOurCompanyOpen(false);
  }, [location]);

  // Lock body scroll and keep keyboard navigation inside the mobile drawer.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => mobileCloseButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileMenu();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        mobileMenuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ) ?? [],
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = 'unset';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen || !restoreMenuTriggerFocusRef.current) return;

    const focusTimer = window.setTimeout(() => {
      mobileMenuTriggerRef.current?.focus();
      restoreMenuTriggerFocusRef.current = false;
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [mobileMenuOpen]);

  const displayName = customer
    ? (customer.first_name || customer.email.split('@')[0])
    : null;

  return (
    <>
      <nav className="bg-primary text-primary-foreground relative z-30">
        <div className="container mx-auto px-4 flex items-center justify-between">

          {/* Mobile menu toggle */}
          <button
            className="md:hidden py-3 text-white flex items-center gap-2 font-bold text-sm tracking-widest active:opacity-70"
            onClick={() => setMobileMenuOpen(true)}
            ref={mobileMenuTriggerRef}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="w-5 h-5" />
            MENU
          </button>

          {/* Desktop Links */}
          <ul className="hidden md:flex flex-wrap items-center text-sm font-bold tracking-wide">
            {/* Our Company dropdown */}
            <li
              className="relative"
              onMouseEnter={() => setDesktopCompanyOpen(true)}
              onMouseLeave={() => setDesktopCompanyOpen(false)}
              onFocus={() => setDesktopCompanyOpen(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDesktopCompanyOpen(false);
              }}
            >
              <button
                className="flex items-center gap-1 py-4 px-4 hover:bg-white hover:text-primary transition-colors cursor-pointer uppercase"
                onClick={() => setDesktopCompanyOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setDesktopCompanyOpen(false);
                    event.currentTarget.blur();
                  }
                }}
                aria-haspopup="true"
                aria-expanded={desktopCompanyOpen}
                aria-controls="desktop-company-menu"
              >
                OUR COMPANY <ChevronDown className="w-4 h-4 ml-1" />
              </button>
              <ul
                id="desktop-company-menu"
                className={`absolute left-0 top-full z-50 min-w-[220px] bg-white text-gray-800 shadow-xl border-t-2 border-primary transition-all duration-200 ${
                  desktopCompanyOpen
                    ? 'opacity-100 visible translate-y-0'
                    : 'opacity-0 invisible pointer-events-none translate-y-2'
                }`}
              >
                <li>
                  <Link href="/about"
                    className="block px-5 py-3 text-sm font-bold hover:bg-gray-50 hover:text-accent transition-colors border-b border-gray-100 uppercase tracking-wide">
                    About Us
                  </Link>
                </li>
                <li>
                  <Link href="/personalisation"
                    className="block px-5 py-3 text-sm font-medium hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                    Personalisation
                  </Link>
                </li>
                <li>
                  <Link href="/on-site-measuring"
                    className="block px-5 py-3 text-sm font-medium hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                    On Site Measuring
                  </Link>
                </li>
                <li>
                  <Link href="/uniform-management"
                    className="block px-5 py-3 text-sm font-medium hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                    Uniform Management
                  </Link>
                </li>
                <li>
                  <Link href="/logo-conversions"
                    className="block px-5 py-3 text-sm font-medium hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                    Logo Conversions
                  </Link>
                </li>
                <li>
                  <Link href="/faq"
                    className="block px-5 py-3 text-sm font-medium hover:bg-gray-50 hover:text-primary transition-colors">
                    FAQs
                  </Link>
                </li>
              </ul>
            </li>

            <li>
              <Link href="/products" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors uppercase">
                SHOP
              </Link>
            </li>
            <li>
              <Link href="/bulk-buy-bundles" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors relative flex items-center gap-2 uppercase">
                BULK BUY & BUNDLES
                <span className="bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-sm absolute top-1.5 right-1 font-bold animate-pulse">SALE</span>
              </Link>
            </li>
            <li>
              <Link href="/reviews" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors uppercase">
                OUR REVIEWS
              </Link>
            </li>
            <li>
              <Link href="/knowledge-centre" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors uppercase">
                KNOWLEDGE CENTRE
              </Link>
            </li>
            <li>
              <Link href="/contact" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors uppercase">
                CONTACT US
              </Link>
            </li>
            <li>
              <Link href="/faq" className="block py-4 px-4 hover:bg-white hover:text-primary transition-colors uppercase">
                FAQ
              </Link>
            </li>
          </ul>

          {/* Account & Portal (Desktop) */}
          <div className="hidden md:flex items-center gap-4 py-4 text-sm font-bold tracking-wide">
            {isLoggedIn ? (
              <Link href="/account" className="hover:text-gray-300 transition-colors uppercase">
                MY ACCOUNT{displayName ? ` (${displayName})` : ''}
              </Link>
            ) : (
              <Link href="/login" className="hover:text-gray-300 transition-colors uppercase">
                LOGIN
              </Link>
            )}
            <a
              href={settings?.portalUrl || '/customer-portal/'}
              className="bg-white/10 px-3 py-1.5 rounded-md hover:bg-white hover:text-primary transition-colors uppercase"
              title="Corporate Portal"
            >
              CORPORATE PORTAL
            </a>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={closeMobileMenu} />
          <div
            id="mobile-navigation"
            ref={mobileMenuRef}
            className="relative w-4/5 max-w-[320px] bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-left"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-primary text-white sticky top-0 z-10">
              <span className="font-bold tracking-widest uppercase">Menu</span>
              <button
                ref={mobileCloseButtonRef}
                onClick={closeMobileMenu}
                className="p-1 hover:bg-white/10 rounded-full transition-colors active:scale-95"
                aria-label="Close navigation menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex flex-col py-2">
              <Link href="/products" className="px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between">
                Shop <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>

              {/* Mobile Accordion for Our Company */}
              <div>
                <button
                  onClick={() => setOurCompanyOpen(!ourCompanyOpen)}
                  className="w-full px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between"
                  aria-expanded={ourCompanyOpen}
                >
                  Our Company <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${ourCompanyOpen ? 'rotate-180' : ''}`} />
                </button>
                {ourCompanyOpen && (
                  <div className="bg-gray-50 border-b border-gray-100 py-1">
                    <Link href="/about" className="block px-8 py-2.5 text-sm font-bold text-primary active:bg-gray-200 uppercase">About Us</Link>
                    <Link href="/personalisation" className="block px-8 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-200">Personalisation</Link>
                    <Link href="/on-site-measuring" className="block px-8 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-200">On Site Measuring</Link>
                    <Link href="/uniform-management" className="block px-8 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-200">Uniform Management</Link>
                    <Link href="/logo-conversions" className="block px-8 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-200">Logo Conversions</Link>
                    <Link href="/faq" className="block px-8 py-2.5 text-sm font-medium text-gray-700 active:bg-gray-200">FAQs</Link>
                  </div>
                )}
              </div>

              <Link href="/bulk-buy-bundles" className="px-5 py-3.5 text-base font-bold text-accent border-b border-gray-50 active:bg-red-50 flex items-center justify-between">
                <span>Bulk Buy & Bundles <span className="ml-2 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-sm font-bold uppercase">Sale</span></span>
                <ChevronRight className="w-4 h-4 text-accent/50" />
              </Link>
              <Link href="/reviews" className="px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between">
                Our Reviews <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link href="/knowledge-centre" className="px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between">
                Knowledge Centre <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link href="/contact" className="px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between">
                Contact Us <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link href="/faq" className="px-5 py-3.5 text-base font-bold text-gray-900 border-b border-gray-50 active:bg-gray-50 flex items-center justify-between">
                FAQ <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
            </div>

            <div className="mt-auto p-5 bg-gray-50 border-t border-gray-100 flex flex-col gap-3">
              {isLoggedIn ? (
                <Link href="/account" className="w-full py-3 bg-primary text-white text-center font-bold rounded-md active:bg-primary/90">
                  My Account{displayName ? ` (${displayName})` : ''}
                </Link>
              ) : (
                <Link href="/login" className="w-full py-3 bg-white border-2 border-primary text-primary text-center font-bold rounded-md active:bg-gray-100">
                  Login
                </Link>
              )}
              <a
                href={settings?.portalUrl || '/customer-portal/'}
                className="w-full py-3 bg-gray-200 text-gray-800 text-center font-bold rounded-md active:bg-gray-300"
              >
                Corporate Portal
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
