import { formatCurrency, round2, round3 } from '@shared/calc';

export { formatCurrency, round2, round3 };

/** Compact rupee display for dashboard tiles: ₹1.2L, ₹3.4Cr. */
export function formatCompactCurrency(value: number): string {
  const amount = Math.abs(value);
  if (amount >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return formatCurrency(value);
}

export function formatDisplayDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatGrams(value: number): string {
  return `${round3(value).toFixed(3)} g`;
}

export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toIsoDate(date);
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
