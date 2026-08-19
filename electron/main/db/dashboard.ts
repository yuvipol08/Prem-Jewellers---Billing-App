import { todayIso } from '../../../shared/defaults';
import type { DashboardSummary, InvoiceListRow, PaymentMode } from '../../../shared/types';
import { getDb } from './connection';
import { countCustomers } from './customers';
import { listInvoices } from './invoices';

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function yearStart(): string {
  // Business year, matching the invoice series: 1 April – 31 March.
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-04-01`;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Cancelled bills are excluded everywhere — they are not sales. */
const LIVE = `status <> 'cancelled'`;

export function dashboardSummary(): DashboardSummary {
  const db = getDb();
  const today = todayIso();

  const totalsFor = (from: string, to: string) =>
    db
      .prepare<[string, string]>(
        `SELECT COALESCE(SUM(grand_total), 0) AS total,
                COUNT(*) AS count,
                COALESCE(SUM(total_net_wt), 0) AS net_weight
           FROM invoices
          WHERE ${LIVE} AND invoice_date BETWEEN ? AND ?`,
      )
      .get(from, to) as { total: number; count: number; net_weight: number };

  const todayTotals = totalsFor(today, today);
  const monthTotals = totalsFor(monthStart(), today);
  const yearTotals = totalsFor(yearStart(), today);

  const totalInvoices = db
    .prepare(`SELECT COUNT(*) AS c FROM invoices WHERE ${LIVE}`)
    .get() as { c: number };

  const salesByDayRows = db
    .prepare<[string]>(
      `SELECT invoice_date AS date, COALESCE(SUM(grand_total), 0) AS total
         FROM invoices
        WHERE ${LIVE} AND invoice_date >= ?
        GROUP BY invoice_date
        ORDER BY invoice_date ASC`,
    )
    .all(daysAgoIso(29)) as { date: string; total: number }[];

  const recentInvoices: InvoiceListRow[] = listInvoices({ limit: 8 });

  return {
    todaySales: todayTotals.total,
    todayInvoiceCount: todayTotals.count,
    monthSales: monthTotals.total,
    monthInvoiceCount: monthTotals.count,
    yearSales: yearTotals.total,
    totalCustomers: countCustomers(),
    totalInvoices: totalInvoices.c,
    totalNetWeightThisMonth: monthTotals.net_weight,
    recentInvoices,
    salesByDay: salesByDayRows,
  };
}

export function paymentModeBreakdown(from: string, to: string): { mode: PaymentMode; total: number }[] {
  const rows = getDb()
    .prepare<[string, string]>(
      `SELECT payment_mode AS mode, COALESCE(SUM(grand_total), 0) AS total
         FROM invoices
        WHERE ${LIVE} AND invoice_date BETWEEN ? AND ?
        GROUP BY payment_mode`,
    )
    .all(from, to) as { mode: PaymentMode; total: number }[];
  return rows;
}
