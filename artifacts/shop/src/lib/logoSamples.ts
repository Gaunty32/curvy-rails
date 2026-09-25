export interface LogoSample {
  src: string;
  alt: string;
}

const syntheticSample: LogoSample = {
  src: `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><rect width="400" height="240" rx="24" fill="#f1f5f9"/><circle cx="120" cy="120" r="54" fill="#2563eb"/><path d="M120 82v76M82 120h76" stroke="#fff" stroke-width="12" stroke-linecap="round"/><text x="200" y="130" fill="#334155" font-family="Arial,sans-serif" font-size="30" font-weight="700">SAMPLE</text></svg>',
  )}`,
  alt: 'Synthetic generic branding example',
};

export const LOGO_SAMPLES: LogoSample[] =
  import.meta.env.MODE === 'test' && import.meta.env.VITE_DEMO_SYNTHETIC_LOGO_FIXTURES === 'true'
    ? [syntheticSample]
    : [];