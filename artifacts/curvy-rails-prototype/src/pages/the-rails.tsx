import { PageShell } from '@/components/page-shell';
import { SignupForm } from '@/components/signup-form';
import { RailsSteps } from './home';

export default function TheRails() {
  return (
    <PageShell title="The Rails" description="The Rails is the Curvy Rails loyalty concept: shop, earn, belong, reward, across the website, TikTok and Vinted. Coming later." heading="The Rails" intro="Bought from us on TikTok, Vinted or here? Your loyalty should count.">
      <p className="inline-block border border-black px-3 py-1 text-xs font-bold uppercase tracking-widest">Concept preview - not live yet</p>
      <RailsSteps />
      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div><h2 className="font-display text-2xl uppercase">One community, every channel</h2><p className="mt-2 text-sm leading-relaxed">The plan: whether your relationship with Curvy Rails began on this website, TikTok, Vinted or elsewhere, you can earn recognition and rewards where technically and contractually possible. Nothing is tracked in this prototype.</p></div>
        <div><h2 className="font-display text-2xl uppercase">What's coming</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm"><li>Stars for purchases</li><li>Community recognition</li><li>Treats and early access to drops</li></ul></div>
      </div>
      <div className="mt-12 bg-neutral-200 p-6"><h2 className="font-display mb-3 text-2xl uppercase">Be first to know</h2><SignupForm /></div>
    </PageShell>
  );
}
