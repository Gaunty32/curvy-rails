import { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Header } from './Header';
import { MainNav } from './MainNav';
import { FooterInfoBar } from './FooterInfoBar';
import { Footer } from './Footer';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="sticky top-0 z-40">
        <Header />
        <MainNav />
      </div>
      <main className="flex-1">
        {children}
      </main>
      <FooterInfoBar />
      <Footer />
    </div>
  );
}
