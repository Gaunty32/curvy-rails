import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';
import { useSubmitShopEnquiry } from '@workspace/api-client-react';
import { CheckCircle2, Mail, Phone, ArrowRight, Star, BookOpen, Building2, Shirt } from 'lucide-react';
import { proxyImg } from '@/lib/proxyImg';

interface TeamMember {
  name: string;
  role: string;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
}

function TeamMemberAvatar({ member }: { member: TeamMember }) {
  const [failed, setFailed] = useState(false);
  if (!member.photoUrl || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary font-extrabold text-4xl">
        {member.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={proxyImg(member.photoUrl)}
      alt={member.name}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}


export default function AboutUs() {
  useSEO({
    title: 'About Us',
    description: 'the configured business supply branded workwear and uniforms to businesses across the UK. In-house embroidery, on-site measuring, and bespoke uniform management systems.',
  });

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => fetch('/api/shop/team-members').then(r => r.json()),
    staleTime: 1000 * 60 * 15,
  });

  const submitEnquiry = useSubmitShopEnquiry();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', agreed: false });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitEnquiry.mutate(
      { data: { name: `${form.firstName} ${form.lastName}`.trim(), email: form.email, phone: form.phone, message: `Company: ${form.company} — Discovery Call request` } },
      {
        onSuccess: () => setSubmitted(true),
        onError: () => alert('Something went wrong. Please try again.'),
      }
    );
  };

  return (
    <div className="flex flex-col w-full">

      {/* ── Hero ── */}
      <section className="relative h-64 bg-gradient-to-br from-gray-900 via-slate-800 to-primary flex items-center justify-center overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-20">
          <div className="absolute -top-20 -right-12 w-72 h-72 rounded-full border border-white/40" />
          <div className="absolute -top-10 -right-2 w-52 h-52 rounded-full border border-white/30" />
          <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full border border-white/30" />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider">
          ABOUT US
        </h1>
      </section>

      {/* ── Our Team ── */}
      {teamMembers.length > 0 && (
        <section className="py-16 bg-white">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-primary mb-2">Meet the Team</h2>
            <p className="text-center text-gray-500 mb-12">The people behind the configured business.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-10">
              {teamMembers.map((member, i) => (
                <div key={i} className="text-center group">
                  <div className="aspect-square bg-gray-100 mb-5 overflow-hidden rounded-full max-w-[200px] mx-auto border-4 border-gray-200 group-hover:border-primary transition-colors duration-300">
                    <TeamMemberAvatar member={member} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">{member.name}</h3>
                  <p className="text-primary text-sm font-semibold mt-0.5 uppercase tracking-wide">{member.role}</p>
                  <div className="flex flex-col items-center gap-1.5 mt-3">
                    {member.email && (
                      <a
                        href={`mailto:${member.email}`}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-primary transition-colors text-sm"
                      >
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        {member.email}
                      </a>
                    )}
                    {member.phone && (
                      <a
                        href={`tel:${member.phone}`}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-primary transition-colors text-sm"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        {member.phone}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Intro paragraphs ── */}
      <section className="py-14 container mx-auto px-4 max-w-5xl">
        <p className="text-lg text-gray-700 leading-relaxed mb-4 max-w-3xl mx-auto text-center">
          At the configured business, you'll be working with a team that genuinely cares about your brand almost as much as you do. We believe branded workwear should be straightforward, reliable and backed by people who know exactly what they're doing.
        </p>
        <p className="text-base text-gray-500 leading-relaxed mb-12 max-w-2xl mx-auto text-center">
          Whether you're looking for a smarter way to manage uniforms across multiple locations or high-quality branded clothing for your team, we're here to help.
        </p>

        {/* Image-led audience cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-14">
          {/* Larger Organisations */}
          <div className="flex flex-col border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
            <div className="h-52 overflow-hidden bg-gray-100">
              <div aria-hidden="true" className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 via-gray-50 to-primary/10 text-primary">
                <Building2 className="w-16 h-16 stroke-[1.25] group-hover:scale-110 transition-transform duration-500" />
              </div>
            </div>
            <div className="flex flex-col flex-1 p-6">
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Larger Organisations</span>
              <h3 className="font-bold text-gray-900 text-lg mb-3 leading-snug">AI-powered uniform management</h3>
              <p className="text-sm text-gray-600 leading-relaxed flex-1">
                Our Ordering Portal gives employees access only to what they're entitled to, gives managers full visibility, and tracks every order — reducing admin, cutting unnecessary spend, and simplifying distribution across multiple sites.
              </p>
              <a href="#" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-3 transition-all">
                Try the interactive demo <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Order Branded Workwear */}
          <div className="flex flex-col border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
            <div className="h-52 overflow-hidden bg-gray-100">
              <div aria-hidden="true" className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 via-slate-50 to-primary/10 text-primary">
                <Shirt className="w-16 h-16 stroke-[1.25] group-hover:scale-110 transition-transform duration-500" />
              </div>
            </div>
            <div className="flex flex-col flex-1 p-6">
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Order Branded Workwear</span>
              <h3 className="font-bold text-gray-900 text-lg mb-3 leading-snug">Browse online or get bespoke advice</h3>
              <p className="text-sm text-gray-600 leading-relaxed flex-1">
                No minimum order, a 7-day standard lead time, and a friendly team ready to help. Browse the shop yourself or talk to us and we'll recommend the right garments for your business.
              </p>
              <Link href="/order-workwear" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-3 transition-all">
                Find out more <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        <p className="text-base text-gray-700 leading-relaxed text-center max-w-3xl mx-auto mb-10">
          Whatever the size of your business, our goal is the same: to build long-term partnerships based on great service, honest advice and consistently high-quality products. Between us, we've answered just about every workwear question imaginable.
        </p>

        {/* Reviews + Knowledge Centre nudge */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/reviews" className="flex items-center gap-4 border border-gray-200 p-5 hover:border-primary hover:bg-primary/5 transition-colors group">
            <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm group-hover:text-primary transition-colors">Read our customer reviews</p>
              <p className="text-xs text-gray-500 mt-0.5">See what other businesses say about working with us</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary ml-auto shrink-0 transition-colors" />
          </Link>
          <Link href="/knowledge-centre" className="flex items-center gap-4 border border-gray-200 p-5 hover:border-primary hover:bg-primary/5 transition-colors group">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm group-hover:text-primary transition-colors">Explore the Knowledge Centre</p>
              <p className="text-xs text-gray-500 mt-0.5">Guides, tips and answers to common workwear questions</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary ml-auto shrink-0 transition-colors" />
          </Link>
        </div>
      </section>

      {/* ── Book a Discovery Call ── */}
      <section className="py-16 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-2xl">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2 text-center">Book a Discovery Call</h2>
          <p className="text-center text-gray-500 mb-10">
            Leave your details and we'll send you instant demo access, then follow up to find a time that works.
          </p>

          {submitted ? (
            <div className="text-center py-12 space-y-3">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
              <p className="text-xl font-bold text-gray-900">Thanks — we'll be in touch!</p>
              <p className="text-gray-500 text-sm">Check your inbox for demo access details.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input
                    required
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input
                    required
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
                <input
                  required
                  value={form.company}
                  onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  required
                  type="checkbox"
                  checked={form.agreed}
                  onChange={e => setForm(f => ({ ...f, agreed: e.target.checked }))}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-sm text-gray-600">
                  I agree to your T&amp;Cs and consent to having my data stored and collected *
                </span>
              </label>
              <button
                type="submit"
                disabled={submitEnquiry.isPending}
                className="w-full bg-primary text-white font-bold py-3 px-8 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {submitEnquiry.isPending ? 'SENDING…' : 'BOOK MY DISCOVERY CALL'}
              </button>
            </form>
          )}
        </div>
      </section>

    </div>
  );
}
