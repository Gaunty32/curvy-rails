import type { ReactNode } from 'react';
import { usePageHead } from '@/lib/use-page-head';
export function PageShell({ title, description, heading, intro, children }: { title: string; description: string; heading: string; intro?: string; children?: ReactNode }) {
  usePageHead(title, description);
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">
      <h1 className="font-display text-4xl uppercase md:text-6xl">{heading}</h1>
      {intro && <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{intro}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}
