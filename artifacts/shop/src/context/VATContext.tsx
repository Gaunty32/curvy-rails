import { createContext, useContext, useState } from 'react';

const VAT_RATE = 0.20;
const STORAGE_KEY = 'shop-show-inc-vat';

interface VATContextValue {
  showIncVAT: boolean;
  toggleVAT: () => void;
  vatPrice: (price: number, rate?: number) => number;
  vatLabel: string;
}

const VATContext = createContext<VATContextValue>({
  showIncVAT: true,
  toggleVAT: () => {},
  vatPrice: (p, rate = VAT_RATE) => p * (1 + rate),
  vatLabel: 'Inc. VAT',
});

export function VATProvider({ children }: { children: React.ReactNode }) {
  const [showIncVAT, setShowIncVAT] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? false : stored === 'true';
    } catch {
      return false;
    }
  });

  const toggleVAT = () =>
    setShowIncVAT(v => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });

  const vatPrice = (price: number, rate = VAT_RATE) => showIncVAT ? price * (1 + rate) : price;
  const vatLabel = showIncVAT ? 'Inc. VAT' : 'Ex. VAT';

  return (
    <VATContext.Provider value={{ showIncVAT, toggleVAT, vatPrice, vatLabel }}>
      {children}
    </VATContext.Provider>
  );
}

export const useVAT = () => useContext(VATContext);
