import { Link } from 'wouter';
import { ArrowRight, Heart, Shirt, Truck, Users, ShoppingBag, Star, Gift } from 'lucide-react';
import { usePageHead } from '@/lib/use-page-head';
import { useProducts, asset } from '@/data/catalogue';
import { ProductCard } from '@/components/product-card';
import { SignupForm } from '@/components/signup-form';

const btn = 'inline-flex min-h-12 items-center justify-center gap-2 px-6 text-xs font-bold uppercase tracking-widest';

export default function Home() {
  usePageHead('Clothes made for curves', 'Curvy Rails is a UK range of T-shirts and hoodies for sizes 16-32, grown from a TikTok and Vinted pre-loved community. Demo prototype.');
  const featured = useProducts().slice(0, 4);
  return (
    <>
      <section className="relative overflow-hidden bg-background">
        <img src={asset('assets/hero.jpg')} alt="Three women wearing Curvy Rails tees and a hoodie (placeholder photo)" loading="eager" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-right md:object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent md:via-background/60" />
        <div className="relative mx-auto flex min-h-[540px] max-w-7xl flex-col justify-center px-4 py-14 md:min-h-[600px] md:px-8">
          <h1 className="font-display max-w-xl text-[clamp(1.8rem,9vw,3rem)] uppercase md:text-6xl">Clothes made for curves. Not compromises.</h1>
          <p className="mt-5 max-w-md text-lg">Our own range of tees and hoodies, made for sizes 16-32.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/shop" data-testid="link-hero-shop" className={`${btn} bg-black text-white`}>Shop the collection <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/about" className={`${btn} border border-black bg-white`}>Our story</Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[11px] font-bold uppercase tracking-wider">
            <li className="flex items-center gap-2"><Truck className="h-5 w-5" /> Free UK delivery over £50</li>
            <li className="flex items-center gap-2"><Shirt className="h-5 w-5" /> Sizes 16-32</li>
            <li className="flex items-center gap-2"><Heart className="h-5 w-5" /> Real people. Real curves.</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8">
        <div className="text-center">
          <h2 className="font-display text-4xl uppercase md:text-5xl">Start here</h2>
          <p className="mt-2 text-sm">Our most-loved essentials. Designed for real bodies, in sizes 16-32.</p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">{featured.map((p) => <ProductCard key={p.id} product={p} />)}</div>
      </section>

      <section className="relative overflow-hidden bg-black text-white">
        <img src={asset('assets/community.jpg')} alt="Community members wearing slogan hoodies (placeholder photo)" loading="lazy" className="absolute inset-0 h-full w-full object-cover object-right opacity-60 md:opacity-100" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 md:px-8">
          <h2 className="font-display max-w-md text-4xl uppercase md:text-5xl">You found us. Now stick around.</h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed">Curvy Rails started with a community, buying and selling pre-loved fashion on TikTok and Vinted. Now we're building something of our own — a range of clothes designed for curves, by people who get it.</p>
          <Link href="/community" className={`${btn} mt-6 bg-white text-black`}>Join the community <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:grid-cols-[1.6fr_1fr] md:px-8">
        <div>
          <h2 className="font-display text-3xl uppercase md:text-4xl">The Rails</h2>
          <p className="mt-2 text-sm">Bought from us on TikTok, Vinted or here? Your loyalty should count.</p>
          <RailsSteps />
        </div>
        <div className="flex flex-col justify-center border-black/20 md:border-l md:pl-8">
          <p className="text-sm">Join The Rails, our loyalty scheme. Shop, earn, belong and unlock rewards as part of our growing community.</p>
          <Link href="/the-rails" className={`${btn} mt-4 w-fit border border-black`}>Discover the Rails <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      <section className="border-y bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
          <h2 className="font-display text-3xl uppercase md:text-4xl">Why Curvy Rails?</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:divide-x">
            {[[Shirt, 'Sizes 16-32', 'Because great style should fit you.'], [Heart, 'Made for our community', 'Designed with real people and real curves in mind.'], [Users, 'Real people. Real feedback.', 'Our customers shape what we create next.']].map(([I, t, d], i) => {
              const Icon = I as typeof Shirt;
              return <div key={i} className="flex gap-4 md:pl-8 first:md:pl-0"><Icon className="h-10 w-10 shrink-0" /><div><h3 className="font-bold">{t as string}</h3><p className="text-sm text-muted-foreground">{d as string}</p></div></div>;
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:grid-cols-[1fr_1.4fr] md:px-8">
        <div>
          <h2 className="font-display text-3xl uppercase md:text-4xl">From pre-loved to our own label</h2>
          <p className="mt-3 text-sm leading-relaxed">We started on TikTok and Vinted, sharing pre-loved fashion and building an amazing community. Now we're creating our own range of T-shirts and hoodies, with the same feel-good energy, for sizes 16-32.</p>
          <Link href="/about" className={`${btn} mt-5 border border-black`}>Our story <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <img src={asset('assets/story-1.jpg')} alt="Community member in a Curvy Rails tee (placeholder photo)" loading="lazy" className="aspect-square w-full object-cover" />
          <img src={asset('assets/story-2.jpg')} alt="Packed order flat lay (placeholder photo)" loading="lazy" className="aspect-square w-full object-cover" />
        </div>
      </section>

      <section className="bg-neutral-200">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-8">
          <div><h2 className="font-display text-3xl uppercase">Get on the Rails</h2><p className="text-sm">New drops, live sales and rewards. No nonsense.</p></div>
          <SignupForm />
        </div>
      </section>
    </>
  );
}

export function RailsSteps() {
  const steps = [[ShoppingBag, 'Shop', 'Grab your favourites'], [Star, 'Earn', 'Collect stars'], [Users, 'Belong', 'Be part of the community'], [Gift, 'Reward', 'Get treats and early access']] as const;
  return (
    <ol className="relative mt-8 grid grid-cols-4 gap-2 text-center">
      <div className="absolute left-[12%] right-[12%] top-6 border-t-2 border-dashed border-black" aria-hidden />
      {steps.map(([Icon, t, d]) => (
        <li key={t} className="relative">
          <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-black bg-background"><Icon className="h-5 w-5" /></span>
          <p className="mt-2 text-xs font-extrabold uppercase">{t}</p>
          <p className="text-[11px] text-muted-foreground md:text-xs">{d}</p>
        </li>
      ))}
    </ol>
  );
}
