import { useEffect, useState } from 'react';
import type { DashboardSummary } from '@shared/types';
import { StatTile } from '../components/StatTile';
import { api } from '../lib/api';
import { formatCompactCurrency, formatCurrency, formatDisplayDate, formatGrams } from '../lib/format';

interface DashboardPageProps {
  onOpenInvoice(id: number): void;
  refreshToken: number;
}

/** A minimal bar chart, drawn with divs — no chart library, no load cost. */
function SalesBars({ data }: { data: { date: string; total: number }[] }) {
  if (data.length === 0) {
    return <div className="empty">No sales recorded in the last 30 days.</div>;
  }

  const peak = Math.max(...data.map((point) => point.total), 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, padding: '8px 4px' }}>
      {data.map((point) => (
        <div
          key={point.date}
          title={`${formatDisplayDate(point.date)} — ${formatCurrency(point.total)}`}
          style={{
            flex: 1,
            minWidth: 6,
            // Cap the width so a quiet month does not render as one solid block.
            maxWidth: 44,
            height: `${Math.max(3, (point.total / peak) * 100)}%`,
            background: 'linear-gradient(180deg, var(--brand-hover), var(--brand-deep))',
            borderRadius: '3px 3px 0 0',
          }}
        />
      ))}
    </div>
  );
}

export function DashboardPage({ onOpenInvoice, refreshToken }: DashboardPageProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .dashboard.summary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (!summary) {
    return (
      <div className="page">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-narrow">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
          }}
        >
          <StatTile
            accent
            label="Today's Sales"
            value={formatCurrency(summary.todaySales)}
            sub={`${summary.todayInvoiceCount} invoice${summary.todayInvoiceCount === 1 ? '' : 's'}`}
          />
          <StatTile
            label="This Month"
            value={formatCompactCurrency(summary.monthSales)}
            sub={`${summary.monthInvoiceCount} invoices · ${formatGrams(summary.totalNetWeightThisMonth)} net`}
          />
          <StatTile
            label="This Financial Year"
            value={formatCompactCurrency(summary.yearSales)}
            sub={`${summary.totalInvoices} invoices in total`}
          />
          <StatTile
            label="Customers"
            value={String(summary.totalCustomers)}
            sub="Saved in the customer book"
          />
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <h2 className="card-title">Last 30 Days</h2>
          </div>
          <div className="card-body">
            <SalesBars data={summary.salesByDay} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Recent Bills</h2>
          </div>
          <div className="card-body tight">
            {summary.recentInvoices.length === 0 ? (
              <div className="empty">
                <div className="empty-title">No bills yet</div>
                <div>Your most recent invoices will appear here.</div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th className="num">Amount</th>
                    <th>Payment</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {summary.recentInvoices.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">
                        <strong>{row.invoiceNo}</strong>
                      </td>
                      <td className="nowrap">{formatDisplayDate(row.invoiceDate)}</td>
                      <td>{row.customerName || '—'}</td>
                      <td className="num">{formatCurrency(row.grandTotal)}</td>
                      <td>
                        <span className={`badge ${row.paymentMode.toLowerCase()}`}>
                          {row.paymentMode}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onOpenInvoice(row.id)}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
