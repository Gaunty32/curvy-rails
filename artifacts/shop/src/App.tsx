import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { CartProvider } from '@/context/CartContext';
import { ShopAuthProvider } from '@/context/ShopAuthContext';
import { VATProvider } from '@/context/VATContext';
import { Layout } from '@/components/Layout';
import { SeoOverlayManager } from '@/components/SeoOverlayManager';
import Home from '@/pages/Home';
import { AnalyticsRuntime, ConsentBanner, AnalyticsPreferences } from '@/lib/analytics';

// Lazy-loaded pages — each becomes its own JS chunk, reducing initial bundle
const Shop             = lazy(() => import('@/pages/Shop'));
const CategoryPage     = lazy(() => import('@/pages/CategoryPage'));
const ProductDetail    = lazy(() => import('@/pages/ProductDetail'));
const Cart             = lazy(() => import('@/pages/Cart'));
const Checkout         = lazy(() => import('@/pages/Checkout'));
const OrderComplete    = lazy(() => import('@/pages/OrderComplete'));
const AboutUs          = lazy(() => import('@/pages/AboutUs'));
const ContactUs        = lazy(() => import('@/pages/ContactUs'));
const FAQ              = lazy(() => import('@/pages/FAQ'));
const BulkBuyBundles   = lazy(() => import('@/pages/BulkBuyBundles'));
const BundleDetail     = lazy(() => import('@/pages/BundleDetail'));
const Reviews          = lazy(() => import('@/pages/Reviews'));
const KnowledgeCentre  = lazy(() => import('@/pages/KnowledgeCentre'));
const KnowledgeCentreArticle = lazy(() => import('@/pages/KnowledgeCentreArticle'));
const Login            = lazy(() => import('@/pages/Login'));
const Account          = lazy(() => import('@/pages/Account'));
const Personalisation  = lazy(() => import('@/pages/Personalisation'));
const OnSiteMeasuring  = lazy(() => import('@/pages/OnSiteMeasuring'));
const UniformManagement = lazy(() => import('@/pages/UniformManagement'));
const OrderWorkwear = lazy(() => import('@/pages/OrderWorkwear'));
const LogoConversions  = lazy(() => import('@/pages/LogoConversions'));
const LegalPage        = lazy(() => import('@/pages/LegalPage'));
const NotFound         = lazy(() => import('@/pages/not-found'));
const ChatWidget       = lazy(() => import('@/components/ChatWidget'));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function DeferredChatWidget() {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const load = () => setShouldLoad(true);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(load, { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }

    const id = window.setTimeout(load, 1800);
    return () => window.clearTimeout(id);
  }, []);

  if (!shouldLoad) return null;
  return (
    <Suspense fallback={null}>
      <ChatWidget />
    </Suspense>
  );
}

function Router() {
  if (window.location.pathname.replace(/\/+$/, '').endsWith('/callback')) {
    return (
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Home />
        </Suspense>
      </Layout>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/products" component={Shop} />
          <Route path="/category/:slug" component={CategoryPage} />
          <Route path="/product/:slug" component={ProductDetail} />
          <Route path="/cart" component={Cart} />
          <Route path="/checkout" component={Checkout} />
          <Route path="/order-complete" component={OrderComplete} />
          <Route path="/about" component={AboutUs} />
          <Route path="/contact" component={ContactUs} />
          <Route path="/faq" component={FAQ} />
          <Route path="/bulk-buy-bundles" component={BulkBuyBundles} />
          <Route path="/bundle/:slug" component={BundleDetail} />
          <Route path="/reviews" component={Reviews} />
          <Route path="/knowledge-centre" component={KnowledgeCentre} />
          <Route path="/knowledge-centre/:slug" component={KnowledgeCentreArticle} />
          <Route path="/login" component={Login} />
          <Route path="/account" component={Account} />
          <Route path="/personalisation" component={Personalisation} />
          <Route path="/on-site-measuring" component={OnSiteMeasuring} />
          <Route path="/uniform-management" component={UniformManagement} />
          <Route path="/workwear" component={OrderWorkwear} />
          <Route path="/order-workwear" component={OrderWorkwear} />
          <Route path="/logo-conversions" component={LogoConversions} />
          <Route path="/terms">{() => <LegalPage document="terms" />}</Route>
          <Route path="/privacy">{() => <LegalPage document="privacy" />}</Route>
          <Route path="/cookie-policy">{() => <LegalPage document="cookies" />}</Route>
          <Route path="/latest-news">{() => <Redirect to="/knowledge-centre" />}</Route>
          {/* TV display — was previously at root before order-system moved to /order-system */}
          <Route path="/tv-display">{() => {
            const qs = window.location.search;
            window.location.replace(`/order-system/tv-display${qs}`);
            return null;
          }}</Route>
          {/* Legacy redirects — strip old /shop prefix from any URL */}
          <Route path="/shop/product/:slug">{(p: any) => <Redirect to={`/product/${p.slug}`} />}</Route>
          <Route path="/shop/category/:slug">{(p: any) => <Redirect to={`/category/${p.slug}`} />}</Route>
          <Route path="/shop/cart">{() => <Redirect to="/cart" />}</Route>
          <Route path="/shop/checkout">{() => <Redirect to="/checkout" />}</Route>
          <Route path="/shop/knowledge-centre">{() => <Redirect to="/knowledge-centre" />}</Route>
          <Route path="/shop">{() => <Redirect to="/products" />}</Route>
          <Route path="/shop/:rest*">{(p: any) => <Redirect to={`/${p.rest ?? ''}`} />}</Route>
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  const callbackOnly = window.location.pathname.replace(/\/+$/, '').endsWith('/callback');

  return (
    <QueryClientProvider client={queryClient}>
      <ShopAuthProvider>
        <VATProvider>
        <CartProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            {!callbackOnly && <SeoOverlayManager />}
            <Router />
            <AnalyticsRuntime />
            {!callbackOnly && <ConsentBanner />}
            {!callbackOnly && <AnalyticsPreferences />}
            {!callbackOnly && <DeferredChatWidget />}
          </WouterRouter>
        </CartProvider>
        </VATProvider>
      </ShopAuthProvider>
    </QueryClientProvider>
  );
}

export default App;
