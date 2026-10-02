import { PageShell } from '@/components/page-shell';
import { SignupForm } from '@/components/signup-form';
import { asset } from '@/data/catalogue';

export default function Community() {
  return (
    <PageShell title="Community" description="Join the Curvy Rails community from TikTok and Vinted: new drops, live sales and honest feedback." heading="You found us. Now stick around." intro="Real people. Real feedback. Everything we make starts with a conversation.">
      <img src={asset('assets/community.jpg')} alt="Placeholder community photo" className="aspect-[16/9] w-full object-cover" />
      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {[['TikTok', 'Live sales, try-ons and first looks at new drops.'], ['Vinted', 'Pre-loved plus-size fashion, still sold by the community.'], ['Feedback', 'Tell us the fit, fabric and slogans you want next.']].map(([t, d]) => (
          <div key={t} className="border-t-4 border-black pt-3"><h2 className="font-display text-2xl uppercase">{t}</h2><p className="mt-2 text-sm">{d}</p></div>
        ))}
      </div>
      <div className="mt-12 bg-neutral-200 p-6"><h2 className="font-display mb-3 text-2xl uppercase">Get on the Rails</h2><SignupForm /></div>
    </PageShell>
  );
}
