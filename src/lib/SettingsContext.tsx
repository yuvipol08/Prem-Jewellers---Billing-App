import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { AppSettings } from '@shared/types';
import { api } from './api';

interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  save(next: AppSettings): Promise<{ ok: boolean; message?: string }>;
  reload(): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const loaded = await api().settings.get();
    setSettings(loaded);
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  // Theme lives on the document element so the whole token set swaps at once.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.shop.theme;
  }, [settings.shop.theme]);

  const save = useCallback(async (next: AppSettings) => {
    const result = await api().settings.save(next);
    if (result.ok) setSettings(result.data ?? next);
    return { ok: result.ok, message: result.message };
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, loading, save, reload }),
    [settings, loading, save, reload],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider.');
  return context;
}
