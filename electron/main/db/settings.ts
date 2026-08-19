import { DEFAULT_SETTINGS } from '../../../shared/defaults';
import type { AppSettings } from '../../../shared/types';
import { getDb } from './connection';

const SETTINGS_KEY = 'app_settings';

/** Deep-merges stored settings over the defaults so new keys appear after an upgrade. */
function mergeSettings(stored: unknown): AppSettings {
  const base: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!stored || typeof stored !== 'object') return base;

  const source = stored as Partial<AppSettings>;
  return {
    shop: { ...base.shop, ...(source.shop ?? {}) },
    firebase: { ...base.firebase, ...(source.firebase ?? {}) },
    whatsapp: { ...base.whatsapp, ...(source.whatsapp ?? {}) },
  };
}

export function getSettings(): AppSettings {
  const row = getDb()
    .prepare<[string]>(`SELECT value FROM settings WHERE key = ?`)
    .get(SETTINGS_KEY) as { value: string } | undefined;

  if (!row) return mergeSettings(null);

  try {
    return mergeSettings(JSON.parse(row.value));
  } catch {
    // A corrupted blob must never stop the shop from billing.
    return mergeSettings(null);
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const merged = mergeSettings(settings);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function getSyncValue(key: string): string | null {
  const row = getDb()
    .prepare<[string]>(`SELECT value FROM sync_state WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSyncValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}
