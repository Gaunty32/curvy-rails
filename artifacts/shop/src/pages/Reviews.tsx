import { useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { usePublicConfig } from '@/lib/publicConfig';

declare global {
  interface Window {
    NDRSL?: { init: (id: string) => void };
  }
}

export default function Reviews() {
  const { data: publicConfig } = usePublicConfig();
  const endorsal = publicConfig?.widgets?.endorsalReviews;

  useSEO({
    title: 'Customer Reviews',
    description: 'Read what our customers say about the configured business. Real reviews from businesses across the UK who trust us for their workwear and branded uniform needs.',
  });

  useEffect(() => {
    if (!endorsal?.widgetId || !endorsal.embedId) return;
    if (document.getElementById('endorsal-script')) {
      if (window.NDRSL) window.NDRSL.init(endorsal.widgetId);
      return;
    }
    const script = document.createElement('script');
    script.id = 'endorsal-script';
    script.defer = true;
    script.src = 'https://cdn.endorsal.io/widgets/widget.min.js';
    script.onload = () => window.NDRSL?.init(endorsal.widgetId);
    document.head.appendChild(script);
  }, [endorsal?.widgetId, endorsal?.embedId]);

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative bg-primary py-14 sm:py-20 text-white text-center overflow-hidden">
        <div className="relative z-10 container mx-auto px-4">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-wide uppercase mb-3">
            Our Reviews
          </h1>
          <p className="text-white/70 text-sm sm:text-base max-w-md mx-auto">
            Don't take our word for it — here's what UK businesses say about working with us.
          </p>
        </div>
      </section>

      <section className="py-12 bg-gray-50">
        <div className="container mx-auto px-4 max-w-6xl">
          {endorsal?.widgetId && endorsal.embedId ? (
            <div id={`ndrsl-wol-${endorsal.embedId}`} className="ndrsl-widget" />
          ) : (
            <p className="text-center text-sm text-gray-600">Reviews are not available yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
