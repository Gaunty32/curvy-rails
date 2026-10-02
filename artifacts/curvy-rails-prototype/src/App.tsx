import { type ReactNode } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteLayout } from '@/components/site-layout';
import { BasketProvider } from '@/data/basket';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Shop from '@/pages/shop';
import ProductPage from '@/pages/product';
import BasketPage from '@/pages/basket';
import About from '@/pages/about';
import Community from '@/pages/community';
import TheRails from '@/pages/the-rails';
import Contact from '@/pages/contact';
import Admin from '@/pages/admin';
import { DeliveryReturns, Privacy, Terms } from '@/pages/legal';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

function Router() {
  return (
    <SiteLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/shop">{() => <Shop />}</Route>
          <Route path="/t-shirts">{() => <Shop category="tshirt" />}</Route>
          <Route path="/hoodies">{() => <Shop category="hoodie" />}</Route>
          <Route path="/products/:slug" component={ProductPage} />
          <Route path="/basket" component={BasketPage} />
          <Route path="/about" component={About} />
          <Route path="/community" component={Community} />
          <Route path="/the-rails" component={TheRails} />
          <Route path="/contact" component={Contact} />
          <Route path="/delivery-returns" component={DeliveryReturns} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/admin" component={Admin} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </SiteLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <TooltipProvider>
      <BasketProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
      </BasketProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
