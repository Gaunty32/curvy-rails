import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';
import { LayoutDashboard, PoundSterling, ClipboardList, Truck } from 'lucide-react';

const STEPS = [
  {
    icon: LayoutDashboard,
    number: '01',
    title: 'Create an Attractive Business Image',
    body: `Our web-based ordering system gives you complete control over your uniform programme. Manage wearer information, site-specific order history, and spending limits — all in one place.`,
  },
  {
    icon: PoundSterling,
    number: '02',
    title: 'Set Annual Spending Limits',
    body: `Set budgets per employee, per department, per location or for the overall company. Your spend will never exceed your budget, year after year — with full visibility at every level.`,
  },
  {
    icon: ClipboardList,
    number: '03',
    title: 'Manage the Uniform Issue',
    body: `Track every order by wearer, department or site. Generate stock forecasting and bespoke reports, all available via your own secure log-in on your personal section of our portal.`,
  },
  {
    icon: Truck,
    number: '04',
    title: 'Streamline Your Despatch',
    body: `We supply all workwear in individually packaged wearerpacks, with unique methods of ensuring your uniform issue is completely trouble-free — all at no extra cost.`,
  },
];

export default function UniformManagement() {
  useSEO({
    title: 'Uniform Management System',
    description: 'Bespoke online uniform management portals for multi-site businesses. Set annual spend limits per employee, department or site. Full wearer size history and order tracking.',
  });
  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative bg-primary py-16 flex items-center justify-center overflow-hidden">
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase text-center px-4">
          Uniform Management
        </h1>
      </section>

      {/* ── Main intro copy ── */}
      <section className="py-14 container mx-auto px-4 max-w-4xl">
        <p className="text-lg text-gray-700 leading-relaxed mb-5">
          At the configured business, you'll be working with a team that genuinely cares about your brand almost as much as you do. We believe branded workwear should be straightforward, reliable and backed by people who know exactly what they're doing.
        </p>
        <p className="text-lg text-gray-700 leading-relaxed mb-10">
          Whether you're looking for a smarter way to manage uniforms across multiple locations or high-quality branded clothing for your team, we're here to help.
        </p>

        {/* Audience cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="overflow-hidden border border-gray-200 rounded-sm">
            <img src="/images/larger-organisations.png" alt="Teams in branded workwear across industries" className="w-full h-36 object-cover" />
            <div className="bg-gray-50 p-6">
              <h3 className="font-bold text-primary mb-3 text-base uppercase tracking-wide">Larger Organisations</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                Our innovative AI-powered Ordering Portal helps you take control of uniform ordering, budgets and distribution. Employees can order only what they're entitled to, managers retain complete visibility, and every order is fully tracked — helping reduce administration, eliminate unnecessary spend and simplify uniform management across multiple sites.
              </p>
            </div>
          </div>
          <div className="overflow-hidden border border-gray-200 rounded-sm">
            <img src="/images/order-workwear.png" alt="Team in branded workwear" className="w-full h-36 object-cover" />
            <div className="bg-gray-50 p-6">
              <h3 className="font-bold text-primary mb-3 text-base uppercase tracking-wide">Order Branded Workwear</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                We make ordering branded workwear easy. With no minimum order quantity, a 7-day standard lead time, and a friendly team ready to help, you can order exactly what you need, when you need it.
              </p>
            </div>
          </div>
        </div>

        <p className="text-base text-gray-700 leading-relaxed mb-5">
          Whatever the size of your business, our goal is the same: to build long-term partnerships based on great service, honest advice and consistently high-quality products. Between us, we've answered just about every workwear question imaginable, so we're always happy to share our experience and help you find the right solution.
        </p>
        <p className="text-base text-gray-700 leading-relaxed">
          Take a look at our{' '}
          <Link href="/reviews" className="text-primary font-semibold hover:underline">
            customer reviews
          </Link>{' '}
          and explore our{' '}
          <Link href="/knowledge-centre" className="text-primary font-semibold hover:underline">
            Knowledge Centre
          </Link>{' '}
          to see how we work. Better still, give us a call — we'd love to learn more about your business and show you how the configured business can help.
        </p>
      </section>

      {/* ── How the system works ── */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">How Our System Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {STEPS.map(({ icon: Icon, number, title, body }) => (
              <div
                key={number}
                className="relative border border-gray-200 rounded-sm p-8 flex flex-col gap-4 bg-white hover:border-primary/40 transition-colors"
              >
                <span className="absolute top-4 right-5 text-6xl font-extrabold text-gray-100 select-none leading-none">
                  {number}
                </span>
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 leading-snug">{title}</h3>
                <p className="text-gray-600 leading-relaxed text-sm">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Key features ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Key Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {[
            { title: 'Annual Spending Limits', desc: 'Set budgets per employee, department, location or company-wide.' },
            { title: 'Wearer Size Profiles', desc: 'Full size history for every wearer — no re-measuring needed each order.' },
            { title: 'Order History', desc: 'Complete record of every order, by wearer, department or site.' },
            { title: 'Bespoke Reports', desc: 'Stock forecasting and custom reports available via your secure log-in.' },
          ].map(({ title, desc }) => (
            <div key={title} className="border border-gray-200 p-5 bg-white">
              <h3 className="font-bold text-primary mb-1">{title}</h3>
              <p className="text-sm text-gray-600">{desc}</p>
            </div>
          ))}
        </div>

        <div className="bg-primary/5 border-l-4 border-primary p-6 mb-10">
          <p className="text-base text-gray-800">
            To view a demonstration please visit{' '}
            <a href="#" className="text-primary font-semibold hover:underline">
              Configure your business website
            </a>{' '}
            and use the username <strong>demo</strong> and password <strong>demo</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors">
            Talk to an Adviser
          </Link>
          <a
            href="#"
            target="_blank"
            rel="noreferrer"
            className="inline-block border-2 border-primary text-primary font-bold px-8 py-3 hover:bg-primary hover:text-white transition-colors"
          >
            Corporate Portal
          </a>
        </div>
      </section>
    </div>
  );
}
