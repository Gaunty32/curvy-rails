import { useEffect } from 'react';
import { usePublicConfig } from '@/lib/publicConfig';

interface SEOProps {
  title: string;
  description?: string;
}

/**
 * Updates document.title and meta tags for Google/AI search ranking.
 * Call at the top of every page component.
 */
export function useSEO({ title, description }: SEOProps) {
  const { data: config } = usePublicConfig();
  const baseTitle = config?.businessName || config?.tradingName || 'Business setup required';
  const fullTitle = title === baseTitle ? title : `${title} | ${baseTitle}`;

  useEffect(() => {
    document.title = fullTitle;

    const setMeta = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };

    setMeta('meta[property="og:title"]',       'content', fullTitle);
    setMeta('meta[name="twitter:title"]',       'content', fullTitle);

    if (description) {
      setMeta('meta[name="description"]',        'content', description);
      setMeta('meta[property="og:description"]', 'content', description);
      setMeta('meta[name="twitter:description"]','content', description);
    }

    return () => {
      // Restore defaults on unmount so stale titles don't linger on fast-nav
      document.title = `${baseTitle} — Business website`;
    };
  }, [fullTitle, description]);
}
