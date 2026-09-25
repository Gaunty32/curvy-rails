import { useEffect, useState, type ReactElement } from 'react';
import { useLocation } from 'wouter';

export type AnalyticsEventName =
  | 'PAGE_VIEW' | 'CATEGORY_VIEW' | 'PRODUCT_VIEW' | 'SEARCH'
  | 'ADD_TO_BASKET' | 'REMOVE_FROM_BASKET' | 'BEGIN_CHECKOUT'
  | 'CHECKOUT_COMPLETED' | 'ORDER_COMPLETED';

type Channel = 'ORGANIC_SEARCH' | 'DIRECT' | 'REFERRAL' | 'EMAIL' | 'SOCIAL' | 'PAID_SEARCH' | 'OTHER';
type Attribution = {
  landingPath: string; referrerDomain?: string; referrerPath?: string;
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string;
  channel: Channel; deviceCategory: 'mobile' | 'tablet' | 'desktop' | 'unknown';
};
type QueuedEvent = Record<string, unknown> & { eventId: string; eventType: AnalyticsEventName };

const CONSENT_KEY = 'sbs_analytics_consent';
const VISITOR_KEY = 'sbs_analytics_visitor_id';
const SESSION_KEY = 'sbs_analytics_session_id';
const TOUCH_KEY = 'sbs_analytics_first_touch';
const SESSION_TOUCH_KEY = 'sbs_analytics_session_touch';
const LAST_ACTIVITY_KEY = 'sbs_analytics_session_activity';
const SESSION_TIMEOUT = 30 * 60 * 1000;
let queue: QueuedEvent[] = [];
let flushTimer: number | undefined;
const sent = new Set<string>();
const transitionKeys = new Set<string>();

function uuid(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')).join('');
  }
  return '00000000-0000-4000-8000-' + `${Date.now()}${Math.random()}`.replace(/\D/g, '').slice(-12).padStart(12, '0');
}
function pathOnly(path = window.location.pathname): string {
  const p = path.split('?')[0].replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : '/';
}
function bounded(value: string | null | undefined, max = 100): string | undefined {
  const v = value?.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
  return v || undefined;
}
function deviceCategory(): Attribution['deviceCategory'] {
  const w = window.innerWidth;
  return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
}
function classify(url: URL, referrer: string): Channel {
  const medium = (url.searchParams.get('utm_medium') || '').toLowerCase();
  const source = (url.searchParams.get('utm_source') || '').toLowerCase();
  if (['cpc', 'ppc', 'paid', 'paidsearch', 'display', 'sem'].includes(medium) || url.searchParams.has('gclid') || url.searchParams.has('msclkid')) return 'PAID_SEARCH';
  if (['email', 'e-mail', 'newsletter'].includes(medium)) return 'EMAIL';
  if (['social', 'social-media', 'social_network'].includes(medium) || /facebook|instagram|linkedin|twitter|tiktok|pinterest|youtube/i.test(source)) return 'SOCIAL';
  if (['organic', 'seo'].includes(medium) || /google|bing|yahoo|duckduckgo|ecosia|baidu/i.test(referrer)) return 'ORGANIC_SEARCH';
  if (!referrer && !source && !medium) return 'DIRECT';
  if (referrer) {
    try { if (new URL(referrer).origin !== window.location.origin) return 'REFERRAL'; } catch { return 'OTHER'; }
  }
  return 'OTHER';
}
function currentTouch(): Attribution {
  const url = new URL(window.location.href);
  const ref = document.referrer;
  let referrerDomain: string | undefined;
  let referrerPath: string | undefined;
  try {
    const r = ref ? new URL(ref) : null;
    if (r && r.origin !== window.location.origin) { referrerDomain = bounded(r.hostname, 120); referrerPath = pathOnly(r.pathname); }
  } catch { /* malformed referrer is ignored */ }
  return {
    landingPath: pathOnly(), referrerDomain, referrerPath,
    utmSource: bounded(url.searchParams.get('utm_source'), 80),
    utmMedium: bounded(url.searchParams.get('utm_medium'), 40),
    utmCampaign: bounded(url.searchParams.get('utm_campaign'), 120),
    utmContent: bounded(url.searchParams.get('utm_content'), 120),
    utmTerm: bounded(url.searchParams.get('utm_term'), 80),
    channel: classify(url, ref), deviceCategory: deviceCategory(),
  };
}
function consent(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(CONSENT_KEY) === 'granted';
}
export function analyticsConsent(): 'granted' | 'declined' | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(CONSENT_KEY);
  return value === 'granted' || value === 'declined' ? value : null;
}
export function setAnalyticsConsent(value: 'granted' | 'declined'): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONSENT_KEY, value);
  if (value === 'granted') ensureIdentity();
  else {
    queue = []; sent.clear(); transitionKeys.clear();
    for (const key of [VISITOR_KEY, SESSION_KEY, TOUCH_KEY, SESSION_TOUCH_KEY, LAST_ACTIVITY_KEY]) {
      try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* storage may be unavailable */ }
    }
  }
  window.dispatchEvent(new CustomEvent('analytics-consent', { detail: value }));
}
function ensureIdentity(): { visitorId: string; sessionId: string; touch: Attribution; sessionTouch: Attribution } | null {
  if (!consent()) return null;
  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) { visitorId = uuid(); localStorage.setItem(VISITOR_KEY, visitorId); }
  const now = Date.now();
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  const last = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  if (!sessionId || now - last > SESSION_TIMEOUT) {
    sessionId = uuid(); sessionStorage.setItem(SESSION_KEY, sessionId);
    sessionStorage.removeItem(SESSION_TOUCH_KEY);
  }
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  let touch = JSON.parse(localStorage.getItem(TOUCH_KEY) || 'null') as Attribution | null;
  if (!touch) { touch = currentTouch(); localStorage.setItem(TOUCH_KEY, JSON.stringify(touch)); }
  let sessionTouch = JSON.parse(sessionStorage.getItem(SESSION_TOUCH_KEY) || 'null') as Attribution | null;
  if (!sessionTouch) { sessionTouch = currentTouch(); sessionStorage.setItem(SESSION_TOUCH_KEY, JSON.stringify(sessionTouch)); }
  return { visitorId, sessionId, touch, sessionTouch };
}
function flush(): void {
  flushTimer = undefined;
  if (!queue.length || !consent()) return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ visitorId: ensureIdentity()?.visitorId, sessionId: ensureIdentity()?.sessionId, events });
  try {
    const ok = navigator.sendBeacon?.('/api/shop/analytics/events', new Blob([body], { type: 'application/json' }));
    if (!ok) void fetch('/api/shop/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* measurement must never affect shopping */ }
}
export function track(eventType: AnalyticsEventName, data: Record<string, unknown> = {}): void {
  if (!consent()) return;
  const dedupeKey = typeof data._dedupeKey === 'string' ? data._dedupeKey : undefined;
  if (dedupeKey && transitionKeys.has(dedupeKey)) return;
  if (dedupeKey) transitionKeys.add(dedupeKey);
  const identity = ensureIdentity();
  if (!identity) return;
  const eventId = uuid();
  if (sent.has(eventId)) return;
  sent.add(eventId);
  const { _dedupeKey: _ignored, ...eventData } = data;
  queue.push({ eventId, eventType, occurredAt: new Date().toISOString(), path: pathOnly(), ...eventData, ...identity.sessionTouch });
  try { (window as any).umami?.track(eventType.toLowerCase(), { path: pathOnly() }); } catch { /* optional secondary analytics */ }
  if (queue.length >= 5) flush(); else if (!flushTimer) flushTimer = window.setTimeout(flush, 1500);
}
export function getAttributionContext(): { visitorId: string; sessionId: string; firstTouch: Attribution; lastTouch: Attribution } | null {
  const identity = ensureIdentity();
  if (!identity) return null;
  const sessionTouch = JSON.parse(sessionStorage.getItem(SESSION_TOUCH_KEY) || 'null') as Attribution | null;
  return { visitorId: identity.visitorId, sessionId: identity.sessionId, firstTouch: identity.touch, lastTouch: sessionTouch ?? identity.touch };
}

export function AnalyticsRuntime(): ReactElement | null {
  const [location] = useLocation();
  const [consentState, setConsentState] = useState(analyticsConsent());
  useEffect(() => {
    const onConsent = () => setConsentState(analyticsConsent());
    window.addEventListener('analytics-consent', onConsent);
    return () => window.removeEventListener('analytics-consent', onConsent);
  }, []);
  useEffect(() => {
    if (consentState !== 'granted') return;
    const normalized = pathOnly(location);
    track('PAGE_VIEW', { _dedupeKey: `page:${normalized}` });
    const search = new URLSearchParams(window.location.search).get('search');
    if (search) track('SEARCH', { searchTerm: bounded(search, 80), _dedupeKey: `search:${normalized}:${bounded(search, 80)}` });
  }, [location, consentState]);
  return null;
}

export function ConsentBanner(): ReactElement | null {
  const [choice, setChoice] = useState(analyticsConsent());
  if (choice) return null;
  return <div role="dialog" aria-label="Analytics consent" className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white p-4 shadow-lg">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-700">Allow anonymous analytics to help us improve the shop? Necessary storage for your basket is unaffected.</p>
      <div className="flex gap-2">
        <button className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => { setAnalyticsConsent('declined'); setChoice('declined'); }}>Decline</button>
        <button className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white" onClick={() => { setAnalyticsConsent('granted'); setChoice('granted'); }}>Allow analytics</button>
      </div>
    </div>
  </div>;
}

/** Small, accessible control allowing a previously saved choice to be changed. */
export function AnalyticsPreferences(): ReactElement {
  const [choice, setChoice] = useState(analyticsConsent());
  if (!choice) return <></>;
  return <button
    type="button"
    aria-label="Change analytics preference"
    className="fixed bottom-2 right-2 z-40 rounded bg-white/95 px-2 py-1 text-[11px] text-gray-600 shadow ring-1 ring-gray-200 hover:text-primary"
    onClick={() => {
      const next = choice === 'granted' ? 'declined' : 'granted';
      setAnalyticsConsent(next);
      setChoice(next);
    }}
  >Analytics: {choice === 'granted' ? 'on' : 'off'} (change)</button>;
}