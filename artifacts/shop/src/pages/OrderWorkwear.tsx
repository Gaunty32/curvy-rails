import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';
import { ShoppingBag, MessageCircle, Clock, PackageCheck, Shirt, Star, ArrowRight, CheckCircle } from 'lucide-react';

const BENEFITS = [
  { icon: PackageCheck, title: 'No minimum order', body: 'Order one item or one thousand — we treat every order the same.' },
  { icon: Clock, title: '7-day standard lead time', body: 'Most orders dispatched within a week. Rush options available on request.' },
  { icon: Shirt, title: 'In-house decoration', body: 'Embroidery and heat-seal printing done on site — no third-party delays.' },
  { icon: Star, title: 'Free logo digitisation', body: 'We convert your logo for free when you place your first order.' },
];

const CATEGORIES = [
  { label: 'Polo Shirts', slug: 'polo-shirts' },
  { label: 'T-Shirts', slug: 't-shirts' },
  { label: 'Fleeces & Knitwear', slug: 'fleeces-knitwear' },
  { label: 'Jackets & Outerwear', slug: 'jackets-outerwear' },
  { label: 'Trousers & Workwear', slug: 'trousers-workwear' },
  { label: 'Accessories', slug: 'accessories' },
];

export default function OrderWorkwear() {
  useSEO({
    title: 'Order Branded Workwear',
    description: 'Order high-quality branded workwear and uniforms for your business. No minimum order, 7-day lead time, free logo digitisation. Browse online or call for bespoke advice.',
  });

  return (
    <div className="flex flex-col w-full">

      {/* Hero */}
      <section className="relative bg-primary py-20 flex flex-col items-center justify-center text-center px-4 overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <p className="text-white/70 text-xs font-bold uppercase tracking-widest mb-3">Branded Workwear</p>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4 relative z-10">
          High-quality workwear,<br />exactly when you need it
        </h1>
        <p className="text-white/80 text-lg max-w-xl mb-8 relative z-10">
          No minimum orders. A 7-day standard lead time. And a friendly team ready to help you get it right first time.
        </p>
        <div className="flex flex-wrap gap-3 justify-center relative z-10">
          <Link href="/products" className="inline-flex items-center gap-2 bg-white text-primary font-bold px-7 py-3 hover:bg-gray-100 transition-colors">
            <ShoppingBag className="w-4 h-4" /> Browse the shop
          </Link>
          <Link href="/contact" className="inline-flex items-center gap-2 border-2 border-white/60 text-white font-bold px-7 py-3 hover:border-white hover:bg-white/10 transition-colors">
            <MessageCircle className="w-4 h-4" /> Talk to us first
          </Link>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-14 container mx-auto px-4 max-w-5xl">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">Why businesses choose us</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="text-center p-6 border border-gray-100 bg-white hover:border-primary/30 transition-colors">
              <div className="w-11 h-11 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-bold text-gray-900 mb-2 text-sm">{title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Shop categories */}
      <section className="py-12 bg-gray-50 border-y border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Browse by category</h2>
            <Link href="/products" className="text-sm font-semibold text-primary inline-flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {CATEGORIES.map(({ label, slug }) => (
              <Link
                key={slug}
                href={`/category/${slug}`}
                className="border border-gray-200 bg-white p-5 font-semibold text-gray-800 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all flex items-center justify-between group"
              >
                {label}
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="py-14 container mx-auto px-4 max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">What's included with every order</h2>
            <ul className="space-y-3">
              {[
                'Your logo embroidered or printed on every garment',
                'Individual packaging — ready to hand straight to your team',
                'Free logo digitisation on your first order',
                'Full colour matching to your brand guidelines',
                'Ethical sourcing — SA8000 and ISO14000 certified factories',
                'Reorder any time, with no minimums',
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                  <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-gray-50 border border-gray-200 p-8 text-center">
            <MessageCircle className="w-10 h-10 text-primary mx-auto mb-4" />
            <h3 className="font-bold text-gray-900 text-lg mb-3">Not sure where to start?</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-6">
              Tell us about your business and what you're looking for. We'll recommend the right garments, decoration method and quantities — with no obligation.
            </p>
            <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors w-full">
              Get free advice
            </Link>
            <p className="text-xs text-gray-400 mt-3">Contact the configured business for assistance.</p>
          </div>
        </div>
      </section>

      {/* Social proof nudge */}
      <section className="py-10 bg-primary/5 border-t border-primary/10">
        <div className="container mx-auto px-4 max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-6">
          <p className="text-gray-700 font-medium text-center sm:text-left">
            See what other businesses say about working with us
          </p>
          <Link href="/reviews" className="inline-flex items-center gap-2 border border-primary text-primary font-bold px-6 py-2.5 hover:bg-primary hover:text-white transition-colors shrink-0">
            <Star className="w-4 h-4" /> Read our reviews
          </Link>
        </div>
      </section>

    </div>
  );
}
