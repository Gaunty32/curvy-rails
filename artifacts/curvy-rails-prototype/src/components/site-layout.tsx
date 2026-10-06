import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, ShoppingBag, X } from 'lucide-react';
import { SiFacebook, SiInstagram, SiTiktok, SiYoutube } from 'react-icons/si';
import { Logo } from './logo';
import { useBasket } from '@/data/basket';
import { SignupModalProvider, useSignupModal } from '@/components/signup-modal';

const NAV = [
  ['Shop', '/shop'], ['T-Shirts', '/t-shirts'], ['Hoodies', '/hoodies'], ['The Rails', '/the-rails'], ['Community', '/community'], ['Our Story', '/about'],
] as const;

export function SiteLayout({ children }: { children: ReactNode }) {
  return <SignupModalProvider><SiteLayoutContent>{children}</SiteLayoutContent></SignupModalProvider>;
}

function SiteLayoutContent({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loc] = useLocation();
  const { count } = useBasket();
  useEffect(() => { setOpen(false); }, [loc]);
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <div className="safe-x bg-black py-2 text-center text-[11px] font-semibold uppercase tracking-widest text-white">Free UK mainland delivery over £50 &middot; Sizes 16-32</div>
      <div className="safe-x border-b bg-neutral-200 py-1.5 text-center text-xs leading-snug text-neutral-700" data-testid="text-demo-notice">
        Prototype demo: placeholder products and images, no real orders or payments. Data stays in your browser. All prices include VAT.
      </div>
      <header className="sticky top-0 z-30 border-b border-black/10 bg-background/95 backdrop-blur">
        <div className="safe-x mx-auto flex h-16 max-w-7xl items-center justify-between md:h-20 md:px-8">
          <Link href="/" data-testid="link-home" aria-label="Curvy Rails home"><Logo className="h-11 md:h-14" /></Link>
          <nav className="hidden gap-8 text-xs font-bold uppercase tracking-widest md:flex" aria-label="Main">
            {NAV.map(([l, h]) => <Link key={h} href={h} data-testid={`link-nav-${l.toLowerCase().replace(/\W/g, '')}`} className={loc === h ? 'underline underline-offset-8' : 'hover:underline underline-offset-8'}>{l}</Link>)}
          </nav>
          <div className="flex items-center gap-1">
            <HeaderSignupButton />
            <Link href="/basket" data-testid="link-basket" aria-label={`Basket, ${count} items`} className="relative flex h-11 w-11 items-center justify-center">
              <ShoppingBag className="h-6 w-6" />
              <span data-testid="text-basket-count" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-black px-1 text-[10px] font-bold text-white">{count}</span>
            </Link>
            <button className="flex h-11 w-11 items-center justify-center md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" data-testid="button-menu" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" className="safe-x max-h-[calc(100dvh-7rem)] overflow-y-auto border-t bg-background pb-4 md:hidden" aria-label="Mobile">
            {[...NAV, ['The Rails', '/the-rails'], ['Contact', '/contact']].map(([l, h]) => (
              <Link key={h} href={h} onClick={() => setOpen(false)} className="flex min-h-12 items-center border-b text-sm font-bold uppercase tracking-widest">{l}</Link>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-black text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] md:px-8">
          <div><Logo light className="h-24" /><p className="mt-4 max-w-xs text-xs text-neutral-400">Prototype demo site. Placeholder products and photography.</p></div>
          <FooterCol title="Shop" links={[['All Products', '/shop'], ['T-Shirts', '/t-shirts'], ['Hoodies', '/hoodies']]} />
          <FooterCol title="Help" links={[['Delivery & Returns', '/delivery-returns'], ['Contact', '/contact'], ['Basket', '/basket']]} />
          <FooterCol title="Community" links={[['Our Story', '/about'], ['The Rails', '/the-rails'], ['Community', '/community']]} />
          <div>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-widest">Stay in the loop</h4>
            <SignupFooterButton />
            <div className="mt-5 flex gap-6 text-xl" aria-label="Social (demo, not linked)"><SiTiktok /><SiInstagram /><SiFacebook /><SiYoutube /></div>
          </div>
        </div>
        <div className="safe-x safe-b border-t border-white/15 pt-4 text-xs text-neutral-400 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 md:flex-row">
            <span>&copy; 2026 Curvy Rails. Demonstration prototype.</span>
            <span className="flex flex-wrap gap-x-5"><Link href="/terms" className="inline-flex min-h-11 items-center">Terms &amp; Conditions</Link><Link href="/privacy" className="inline-flex min-h-11 items-center">Privacy Policy</Link><Link href="/admin" data-testid="link-admin" className="inline-flex min-h-11 items-center">Demo catalogue editor</Link></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
function HeaderSignupButton() {
  const { openSignup } = useSignupModal();
  return <button data-testid="button-header-signup" type="button" onClick={openSignup} className="inline-flex min-h-11 items-center bg-black px-2.5 text-[9px] font-extrabold uppercase tracking-widest text-white sm:px-4 sm:text-[10px]"><span className="sm:hidden">Join</span><span className="hidden sm:inline">Join The Rails</span></button>;
}
function SignupFooterButton() {
  const { openSignup } = useSignupModal();
  return <button data-testid="button-footer-signup" type="button" onClick={openSignup} className="min-h-11 border border-white/60 px-4 text-[10px] font-extrabold uppercase tracking-widest text-white hover:bg-white hover:text-black">Join The Rails</button>;
}
function FooterCol({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-bold uppercase tracking-widest">{title}</h4>
      <ul className="space-y-2 text-sm text-neutral-300">{links.map(([l, h]) => <li key={h}><Link href={h} className="inline-flex min-h-11 items-center hover:text-white md:min-h-0">{l}</Link></li>)}</ul>
    </div>
  );
}
