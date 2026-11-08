import { createContext, useContext, useCallback, type ReactNode } from 'react';

const FALLBACK_RATE = 88.50;

interface AppContextValue {
  formatCurrency: (inr: number) => string;
  formatInr: (inr: number) => string;
  formatCompact: (inr: number) => string;
  formatPrice: (inr: number) => string;
  convert: (usd: number) => number;
  symbol: string;
  usdToInrRate: number;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const usdToInrRate = FALLBACK_RATE;

  const convert = useCallback(
    (usd: number) => usd * usdToInrRate,
    [usdToInrRate],
  );

  const symbol = '₹';

  const formatInr = useCallback(
    (inr: number) => '₹' + inr.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }),
    [],
  );

  const formatCurrency = formatInr;

  const formatPrice = formatInr;

  const formatCompact = useCallback(
    (inr: number) => {
      if (inr >= 10000000) return '₹' + (inr / 10000000).toFixed(2) + 'Cr';
      if (inr >= 100000) return '₹' + (inr / 100000).toFixed(2) + 'L';
      if (inr >= 1000) return '₹' + (inr / 1000).toFixed(1) + 'K';
      return '₹' + inr.toFixed(0);
    },
    [],
  );

  return (
    <AppContext.Provider
      value={{
        formatCurrency,
        formatInr,
        formatCompact,
        formatPrice,
        convert,
        symbol,
        usdToInrRate,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
