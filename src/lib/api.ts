import type { BillingApi } from '@shared/api';

declare global {
  interface Window {
    billing: BillingApi;
  }
}

/**
 * The preload bridge. Accessed through a getter rather than captured at module
 * load so a missing bridge fails with a clear message instead of `undefined`.
 */
export function api(): BillingApi {
  if (!window.billing) {
    throw new Error('The application bridge is unavailable. Please restart the app.');
  }
  return window.billing;
}

export const hasApi = (): boolean => typeof window !== 'undefined' && Boolean(window.billing);
