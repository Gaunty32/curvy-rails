import { Link } from 'wouter';
import { PageShell } from '@/components/page-shell';
import { asset } from '@/data/catalogue';

export default function About() {
  return (
    <PageShell title="Our Story" description="How Curvy Rails grew from pre-loved fashion on TikTok and Vinted into its own label of T-shirts and hoodies for sizes 16-32." heading="Our story" intro="From pre-loved to our own label.">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-4 leading-relaxed">
          <p>Curvy Rails began as a community. We bought, sold and swapped pre-loved plus-size fashion on TikTok and Vinted, because finding clothes that fit and felt good shouldn't be a fight.</p>
          <p>Along the way, you told us what you wanted: better cuts, honest sizing and graphics with some personality. So we're making them.</p>
          <p>Our first range is T-shirts and hoodies in sizes 16-32, designed with real feedback from the people who have been with us from day one. The pre-loved community isn't going anywhere. This is the next chapter.</p>
          <Link href="/shop" className="mt-2 inline-block bg-black px-6 py-3 text-xs font-bold uppercase tracking-widest text-white">Shop the collection</Link>
        </div>
        <img src={asset('assets/story-1.jpg')} alt="Placeholder story photo" className="aspect-square w-full object-cover" />
      </div>
    </PageShell>
  );
}
