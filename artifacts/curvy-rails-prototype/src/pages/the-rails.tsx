import { PageShell } from '@/components/page-shell';
import { SignupForm } from '@/components/signup-form';
import { RailsSteps } from './home';
import { useSignupModal } from '@/components/signup-modal';
import { ArrowRight } from 'lucide-react';

export default function TheRails() {
  const { openRewards } = useSignupModal();
  return (
    <PageShell title="The Rails" description="The Rails is the Curvy Rails loyalty concept: shop, earn, belong, reward, across the website, TikTok and Vinted. Coming later." heading="The Rails" intro="Bought from us on TikTok, Vinted or here? Your loyalty should count.">
      <p className="inline-block border border-black bg-black px-3 py-2 text-xs font-bold uppercase tracking-widest text-white">Concept preview · not live yet · rules to be confirmed</p>
      <div className="mt-6 flex flex-col gap-4 border-y border-black py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-display text-2xl uppercase">How The Rails may work</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">No rates, waiting periods, voucher values or balances have been set. Take a look at the honest preview.</p></div>
        <button data-testid="button-learn-points" type="button" onClick={openRewards} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 bg-black px-5 text-xs font-bold uppercase tracking-widest text-white">Learn about points <ArrowRight className="h-4 w-4" /></button>
      </div>
      <RailsSteps />
      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div><h2 className="font-display text-2xl uppercase">One community, every channel</h2><p className="mt-2 text-sm leading-relaxed">The plan: whether your relationship with Curvy Rails began on this website, TikTok, Vinted or elsewhere, you can earn recognition and rewards where technically and contractually possible. Nothing is tracked in this prototype.</p></div>
        <div><h2 className="font-display text-2xl uppercase">Still being shaped</h2><ul className="mt-2 list-none space-y-2 text-sm"><li className="flex justify-between gap-3 border-b border-black/20 pb-2"><span>How points are earned</span><strong className="text-right uppercase">To be confirmed</strong></li><li className="flex justify-between gap-3 border-b border-black/20 pb-2"><span>When points are approved</span><strong className="text-right uppercase">To be confirmed</strong></li><li className="flex justify-between gap-3"><span>Reward and voucher values</span><strong className="text-right uppercase">To be confirmed</strong></li></ul></div>
      </div>
      <div className="mt-12 bg-neutral-200 p-6"><h2 className="font-display mb-3 text-2xl uppercase">Be part of what comes next</h2><p className="mb-4 max-w-xl text-sm">Join the preview list using the shared signup. This does not activate a points account or guarantee a reward.</p><SignupForm /></div>
    </PageShell>
  );
}
