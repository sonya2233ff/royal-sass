"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  COMPARE_STORES_STORAGE_KEY,
  allCompareStoreIds,
  parseCompareStores,
  toggleCompareStore,
  type CompareStoreId,
} from "@/domain/compare-stores";

type CompareStoresContextValue = {
  enabled: ReadonlySet<CompareStoreId>;
  ready: boolean;
  isOn: (id: CompareStoreId) => boolean;
  toggle: (id: CompareStoreId) => void;
  count: number;
};

const CompareStoresContext = createContext<CompareStoresContextValue | null>(
  null,
);

export function CompareStoresProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<Set<CompareStoreId>>(
    () => new Set(allCompareStoreIds()),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COMPARE_STORES_STORAGE_KEY);
      setEnabled(new Set(parseCompareStores(stored)));
    } catch {
      setEnabled(new Set(allCompareStoreIds()));
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        COMPARE_STORES_STORAGE_KEY,
        JSON.stringify([...enabled]),
      );
    } catch {
      /* private mode */
    }
  }, [enabled, ready]);

  const toggle = useCallback((id: CompareStoreId) => {
    setEnabled((prev) => toggleCompareStore(prev, id));
  }, []);

  const value = useMemo<CompareStoresContextValue>(
    () => ({
      enabled,
      ready,
      isOn: (id) => enabled.has(id),
      toggle,
      count: enabled.size,
    }),
    [enabled, ready, toggle],
  );

  return (
    <CompareStoresContext.Provider value={value}>
      {children}
    </CompareStoresContext.Provider>
  );
}

export function useCompareStores(): CompareStoresContextValue {
  const ctx = useContext(CompareStoresContext);
  if (!ctx) {
    throw new Error("useCompareStores must be used under CompareStoresProvider");
  }
  return ctx;
}
