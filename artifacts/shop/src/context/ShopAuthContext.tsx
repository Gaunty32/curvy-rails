import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export interface ShopCustomer {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  country: string;
}

interface ShopAuthContextValue {
  customer: ShopCustomer | null;
  isLoggedIn: boolean;
  loading: boolean;
  login: (token: string, customer: ShopCustomer) => void;
  logout: () => void;
  refreshCustomer: () => Promise<void>;
}

const STORAGE_KEY = 'shop_customer_token';

const ShopAuthContext = createContext<ShopAuthContextValue>({
  customer: null,
  isLoggedIn: false,
  loading: true,
  login: () => {},
  logout: () => {},
  refreshCustomer: async () => {},
});

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<ShopCustomer | null>(null);
  const [loading, setLoading] = useState(true);

  const getToken = () => localStorage.getItem(STORAGE_KEY);

  const refreshCustomer = useCallback(async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await fetch('/api/shop/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCustomer(data.customer);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        setCustomer(null);
      }
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshCustomer(); }, [refreshCustomer]);

  const login = (token: string, c: ShopCustomer) => {
    localStorage.setItem(STORAGE_KEY, token);
    setCustomer(c);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCustomer(null);
  };

  return (
    <ShopAuthContext.Provider value={{
      customer,
      isLoggedIn: !!customer,
      loading,
      login,
      logout,
      refreshCustomer,
    }}>
      {children}
    </ShopAuthContext.Provider>
  );
}

export function useShopAuth() {
  return useContext(ShopAuthContext);
}

export function getShopToken() {
  return localStorage.getItem(STORAGE_KEY);
}
