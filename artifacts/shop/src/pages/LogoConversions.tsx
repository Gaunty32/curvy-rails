import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

const PROCESS_STEPS = [
  {
    step: '01',
    title: 'Send Us Your Logo',
    desc: 'Email us a JPEG, PNG, PDF or vector file of your logo. Any format works — we handle the conversion.',
  },
  {
    step: '02',
    title: 'We Digitise It',
    desc: 'Our team converts your artwork into a professional embroidery stitch file, optimised for clean results on fabric.',
  },
  {
    step: '03',
    title: 'Sample for Approval',
    desc: 'Within a week you receive a physical embroidered sample in up to twelve colours for your sign-off.',
  },
  {
    step: '04',
    title: 'One-Off Cost, Reused Forever',
    desc: 'Origination is £35 + VAT — paid once. We store your file and apply it to every future order at no extra charge.',
  },
];

const FORMATS = ['JPEG', 'PNG', 'PDF', 'EPS', 'AI', 'SVG'];

export default function LogoConversions() {
  useSEO({
    title: 'Logo Conversions & Digitisation',
    description: 'We digitise your logo into an embroidery stitch file. Send us any format — JPEG, PNG, PDF, AI or EPS. One-off fee of £35 + VAT, then reused on every future order at no extra cost.',
  });
  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-gradient-to-br from-gray-900 via-slate-800 to-primary flex items-center justify-center overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-20">
          <div className="absolute -top-24 -right-10 w-72 h-72 rounded-full border border-white/40" />
          <div className="absolute -top-8 -right-1 w-48 h-48 rounded-full border border-white/30" />
          <div className="absolute -bottom-36 -left-12 w-80 h-80 rounded-full border border-white/30" />
        </div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-wider uppercase">
            Logo Conversions
          </h1>
          <p className="text-white/80 mt-2 text-lg">Free digitisation on your first order</p>
        </div>
      </section>

      {/* Intro */}
      <section className="py-16 container mx-auto px-4 max-w-4xl">
        <p className="text-lg text-gray-700 leading-relaxed mb-4">
          Before we can embroider your company logo onto garments, we need a stitch file — a digital roadmap that tells our embroidery machines exactly where every thread goes. This process is called <strong>digitisation</strong>, and our in-house team handles it for you.
        </p>
        <p className="text-lg text-gray-700 leading-relaxed mb-12">
          All prices include <strong>one free application charge</strong> of your logo. Once your design is digitised, we store it permanently — every future order uses the same file at no additional origination cost.
        </p>

        {/* Process steps */}
        <h2 className="text-2xl font-bold text-primary mb-8">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-14">
          {PROCESS_STEPS.map(({ step, title, desc }) => (
            <div key={step} className="border-2 border-gray-200 p-6 hover:border-primary transition-colors group">
              <div className="text-4xl font-extrabold text-primary/20 group-hover:text-primary/40 transition-colors mb-3">
                {step}
              </div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Pricing highlight */}
        <div className="bg-primary text-white p-8 mb-12 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-3xl font-extrabold">£35 <span className="text-lg font-normal opacity-80">+ VAT</span></p>
            <p className="text-white/80 mt-1">One-off origination fee — never charged again</p>
          </div>
          <div className="text-sm text-white/80 max-w-xs">
            This covers the full digitisation of your logo. All subsequent orders using the same design are charged only for embroidery time, not origination.
          </div>
        </div>

        {/* Accepted formats */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-primary mb-4">Accepted File Formats</h2>
          <div className="flex flex-wrap gap-3">
            {FORMATS.map(fmt => (
              <span key={fmt} className="bg-gray-100 text-gray-700 font-bold text-sm px-4 py-2 border border-gray-200">
                .{fmt}
              </span>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-3">
            Don't have a vector file? Don't worry — send us whatever you have and we'll work with it.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-wrap gap-4">
          <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors">
            Send Us Your Logo
          </Link>
          <Link href="/personalisation" className="inline-block border-2 border-primary text-primary font-bold px-8 py-3 hover:bg-primary hover:text-white transition-colors">
            About Personalisation
          </Link>
        </div>
      </section>
    </div>
  );
}
