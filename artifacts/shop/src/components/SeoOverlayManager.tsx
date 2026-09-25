import { useEffect } from 'react';
import { useLocation } from 'wouter';

interface SeoChange {
  id: string;
  changeType: 'titleTag' | 'metaDescription' | 'heading' | 'publicCopy' | 'internalLink' | 'imageAlt' | 'structuredData';
  selector?: string;
  value: string | Record<string, unknown>;
}

function setMeta(selector: string, value: string) {
  let element = document.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    if (selector.includes('name="description"')) element.name = 'description';
    document.head.appendChild(element);
  }
  element.content = value;
}

function applyChange(change: SeoChange) {
  if (change.changeType === 'titleTag' && typeof change.value === 'string') {
    document.title = change.value;
    return;
  }
  if (change.changeType === 'metaDescription' && typeof change.value === 'string') {
    setMeta('meta[name="description"]', change.value);
    setMeta('meta[property="og:description"]', change.value);
    return;
  }
  if (change.changeType === 'structuredData' && typeof change.value === 'object') {
    const id = `seo-structured-data-${change.id}`;
    let script = document.getElementById(id) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(change.value);
    return;
  }
  if (!change.selector || typeof change.value !== 'string') return;
  document.querySelectorAll<HTMLElement>(change.selector).forEach((element) => {
    if (change.changeType === 'internalLink' && element instanceof HTMLAnchorElement) {
      if (element.getAttribute('href') !== change.value) element.setAttribute('href', change.value);
    } else if (change.changeType === 'imageAlt' && element instanceof HTMLImageElement) {
      if (element.alt !== change.value) element.alt = change.value;
    } else if (change.changeType === 'heading' || change.changeType === 'publicCopy') {
      if (element.textContent !== change.value) element.textContent = change.value;
    }
  });
}

export function SeoOverlayManager() {
  const [location] = useLocation();
  const seoPath = location.split('?')[0] || '/';

  useEffect(() => {
    const controller = new AbortController();
    let observer: MutationObserver | null = null;

    fetch(`/api/public/seo-config?path=${encodeURIComponent(seoPath)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('SEO config unavailable')))
      .then((data: { changes?: SeoChange[] }) => {
        const changes = data.changes ?? [];
        const applyAll = () => changes.forEach(applyChange);
        applyAll();
        observer = new MutationObserver(applyAll);
        observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });

    return () => {
      controller.abort();
      observer?.disconnect();
    };
  }, [seoPath]);

  return null;
}