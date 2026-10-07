import { createContext, useContext } from 'react';

export const GaugeContext = createContext(null);

export function useGauge() {
  const context = useContext(GaugeContext);
  if (!context) {
    throw new Error('useGauge must be used within a Gauge component');
  }
  return context;
}
