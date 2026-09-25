import {
  BarChart3, ShieldCheck, Users, Globe2, ArrowRight, CheckCircle2,
  Shirt, Inbox, Clock, TrendingDown, Building2, Package, Layers,
  ChevronRight, PhoneCall,
} from "lucide-react";

const SHOTS = [
  "/demo-bg/portal.jpg",
  "/demo-bg/wardrobe.png",
  "/demo-bg/orders.jpg",
  "/demo-bg/dashboard.jpg",
];

const COLUMNS: { imgs: string[]; duration: number }[] = [
  { imgs: [SHOTS[0], SHOTS[2], SHOTS[3], SHOTS[1]], duration: 30 },
  { imgs: [SHOTS[1], SHOTS[3], SHOTS[0], SHOTS[2]], duration: 24 },
  { imgs: [SHOTS[2], SHOTS[0], SHOTS[1], SHOTS[3]], duration: 27 },
];

function ScrollColumn({ imgs, duration }: { imgs: string[]; duration: number }) {
  const doubled = [...imgs, ...imgs];
  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        className="demo-scroll-col flex flex-col gap-3"
        style={{ animationDuration: `${duration}s` }}
      >
        {doubled.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="w-full rounded-xl shadow-lg border border-white/10 select-none"
          />
        ))}
      </div>
    </div>
  );
}

const PAIN_POINTS = [
  { icon: Inbox, text: "Chasing workwear orders by phone and email" },
  { icon: TrendingDown, text: "No visibility of what's been spent or by whom" },
  { icon: Users, text: "Staff ordering the wrong items or wrong sizes" },
  { icon: Clock, text: "Slow turnaround because the process isn't joined up" },
  { icon: Building2, text: "Multiple sites impossible to manage consistently" },
  { icon: Layers, text: "No record of who has what across the business" },
];

const BENEFITS = [
  {
    icon: ShieldCheck,
    colour: "bg-blue-500/20 text-blue-400",
    title: "Controlled spend, every time",
    body: "Set budgets per person, per team, or per site. Managers approve orders before they're placed — so spend never runs away from you.",
  },
  {
    icon: Users,
    colour: "bg-violet-500/20 text-violet-400",
    title: "Staff self-service — zero admin",
    body: "Your team orders through their own branded portal. They pick their items, choose their sizes, and submit. No emails to HR, no spreadsheets.",
  },
  {
    icon: Globe2,
    colour: "bg-emerald-500/20 text-emerald-400",
    title: "Multi-site, one system",
    body: "Manage workwear across multiple locations from a single dashboard. Each site sees only what's relevant to them, while you see everything.",
  },
  {
    icon: BarChart3,
    colour: "bg-amber-500/20 text-amber-400",
    title: "Full spend visibility",
    body: "See exactly what's been ordered, by whom, and when — in real time. Make informed decisions about stock, budgets, and supplier contracts.",
  },
  {
    icon: Package,
    colour: "bg-sky-500/20 text-sky-400",
    title: "Your branding, their wardrobe",
    body: "Every item in the portal is already branded, embroidered, or printed for your company. Staff can only order what's approved — nothing off-catalogue.",
  },
  {
    icon: Shirt,
    colour: "bg-rose-500/20 text-rose-400",
    title: "One supplier. One invoice.",
    body: "No more managing multiple garment suppliers. Your configured business can handle sourcing, decoration, quality control, despatch, and one consolidated invoice.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "We set you up",
    body: "We work with you to build your branded wardrobe — the right products, your logo applied, priced and approved before anything goes live.",
  },
  {
    step: "02",
    title: "Your team uses the portal",
    body: "Staff log in to their own portal and order directly. Managers approve, budgets are enforced, and orders flow straight into our production system.",
  },
  {
    step: "03",
    title: "You track everything",
    body: "Every order, every delivery, every pound spent — visible to you in real time. DPD tracking numbers appear automatically when orders ship.",
  },
];

const FITS = [
  "10 to 500+ employees",
  "Single site or multi-location",
  "Mixed workforces with different uniform requirements",
  "Seasonal or high-turnover workwear needs",
  "Businesses replacing a manual or spreadsheet-based process",
  "Organisations with multiple approvers or budget holders",
];

export default function PortalGuide() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="relative flex flex-col md:flex-row min-h-[92vh] overflow-hidden">

        {/* Left: copy */}
        <div className="relative z-10 flex flex-col justify-center w-full md:w-[500px] shrink-0 px-8 py-16 md:py-20 bg-slate-950">

          {/* Brand */}
          <div className="mb-10">
            <div className="inline-flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Shirt className="w-5 h-5 text-blue-400" />
              </div>
              <span className="text-lg font-bold tracking-tight">Your business</span>
            </div>
            <p className="text-slate-500 text-sm">Managed workwear for growing businesses</p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-xs text-blue-400 font-medium mb-5 self-start">
            Built for teams of 10 to 500+
          </div>

          <h1 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4">
            Stop managing workwear.<br />
            <span className="text-blue-400">Start controlling it.</span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-sm">
            A fully managed workwear service — branded portal, staff self-ordering, manager approvals, spend tracking, and a single supplier to deal with. All of it, handled for you.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="mailto:"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors px-6 py-3 text-sm font-semibold text-white shadow-lg"
            >
              <PhoneCall className="w-4 h-4" /> Book a discovery call
            </a>
            <a
              href="#"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-900 transition-colors px-6 py-3 text-sm font-semibold text-slate-300"
            >
              See the system live <ChevronRight className="w-4 h-4" />
            </a>
          </div>

          <p className="mt-8 text-slate-600 text-xs leading-relaxed">
            No obligation. We'll walk you through a live demo tailored to your business.
          </p>
        </div>

        {/* Right: scrolling mosaic */}
        <div className="hidden md:flex flex-1 overflow-hidden relative gap-3 p-4 bg-slate-900">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-900 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-slate-900 to-transparent z-10" />
          {COLUMNS.map((col, i) => (
            <ScrollColumn key={i} imgs={col.imgs} duration={col.duration} />
          ))}
        </div>
      </div>

      {/* ── Pain points ──────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-t border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-center mb-2">Sound familiar?</h2>
          <p className="text-slate-400 text-sm text-center mb-10 max-w-xl mx-auto">
            Most businesses with 10 or more staff run their workwear the same way — and it costs them far more than it should.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PAIN_POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.text} className="flex items-start gap-3 rounded-xl bg-slate-800/50 border border-slate-700/50 px-4 py-4">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-red-400" />
                  </div>
                  <p className="text-sm text-slate-300 leading-snug pt-1">{p.text}</p>
                </div>
              );
            })}
          </div>
          <p className="text-center text-slate-500 text-sm mt-8">
            There's a better way — and it doesn't require you to build anything or manage anything yourself.
          </p>
        </div>
      </div>

      {/* ── Benefits ─────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center mb-2">What you get with the managed service</h2>
        <p className="text-slate-400 text-sm text-center mb-10 max-w-xl mx-auto">
          A complete managed service — we handle the supply chain, the technology, and the logistics. You just approve and track.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {BENEFITS.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.title} className="rounded-xl bg-slate-900 border border-slate-800 p-5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${b.colour}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="font-semibold text-sm mb-1.5">{b.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{b.body}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-y border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-center mb-2">How it works</h2>
          <p className="text-slate-400 text-sm text-center mb-12 max-w-xl mx-auto">
            We do the heavy lifting. From initial setup through to ongoing management — it's all part of the service.
          </p>
          <div className="grid sm:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.step} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden sm:block absolute top-5 left-[calc(100%+1rem)] w-8 h-px bg-slate-700" />
                )}
                <div className="text-3xl font-black text-slate-800 mb-3">{s.step}</div>
                <p className="font-semibold text-sm mb-2">{s.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Who it's for ─────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl font-bold mb-3">Is this the right fit for your business?</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              The managed service works best for businesses where workwear is a real operational need — not a one-off purchase. If any of these apply to you, it's worth a conversation.
            </p>
            <a
              href="mailto:"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors px-6 py-3 text-sm font-semibold text-white"
            >
              Talk to us <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <div className="space-y-3">
            {FITS.map((f) => (
              <div key={f} className="flex items-start gap-3 text-sm text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live demo CTA ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-blue-950 to-slate-950 border-t border-slate-800">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-bold mb-3">See it working for a real business</h2>
          <p className="text-slate-400 text-sm mb-7 max-w-xl mx-auto leading-relaxed">
            Our interactive demo lets you explore the actual system — live data, real orders, the staff portal, and the management dashboard — before committing to anything.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="#"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 transition-colors px-8 py-3 text-sm font-semibold shadow-lg"
            >
              Explore the live demo <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="mailto:"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-900 transition-colors px-8 py-3 text-sm font-semibold text-slate-300"
            >
              <PhoneCall className="w-4 h-4" /> Book a tailored walkthrough
            </a>
          </div>
          <p className="mt-10 text-slate-600 text-xs">
            Your business · Complete contact details in Setup
          </p>
        </div>
      </div>
    </div>
  );
}
