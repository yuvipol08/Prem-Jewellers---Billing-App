import { useCallback, useEffect, useState } from 'react';
import type { Invoice, InvoiceFilter, InvoiceListRow, PaymentMode } from '@shared/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PrintPreview } from '../components/PrintPreview';
import { api } from '../lib/api';
import { formatCurrency, formatDisplayDate, isoDaysAgo, toIsoDate } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { useToast } from '../lib/useToast';

interface InvoicesPageProps {
  /** Hands an invoice to the Billing screen for editing or duplication. */
  onEditInvoice(invoice: Invoice): void;
  /** An invoice id to open immediately, pushed from another screen. */
  openInvoiceId: number | null;
  onOpened(): void;
  refreshToken: number;
}

const RANGES = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 6 },
  { label: 'Last 30 days', days: 29 },
  { label: 'All', days: -1 },
];

export function InvoicesPage({
  onEditInvoice,
  openInvoiceId,
  onOpened,
  refreshToken,
}: InvoicesPageProps) {
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [rangeIndex, setRangeIndex] = useState(2);
  const [fromDate, setFromDate] = useState(isoDaysAgo(29));
  const [toDate, setToDate] = useState(toIsoDate(new Date()));
  const [paymentMode, setPaymentMode] = useState<PaymentMode | ''>('');
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceListRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const term = useDebounced(search, 220);

  const applyRange = useCallback((index: number) => {
    setRangeIndex(index);
    const range = RANGES[index];
    if (range.days < 0) {
      setFromDate('');
      setToDate('');
    } else {
      setFromDate(isoDaysAgo(range.days));
      setToDate(toIsoDate(new Date()));
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const filter: InvoiceFilter = {
        search: term,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        paymentMode: paymentMode || null,
        limit: 500,
      };
      setRows(await api().invoices.list(filter));
    } finally {
      setLoading(false);
    }
  }, [term, fromDate, toDate, paymentMode]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const withInvoice = useCallback(
    async (id: number, action: (invoice: Invoice) => Promise<void> | void) => {
      setBusyId(id);
      try {
        const invoice = await api().invoices.get(id);
        if (!invoice) {
          toast.error('That invoice could not be found.');
          return;
        }
        await action(invoice);
      } finally {
        setBusyId(null);
      }
    },
    [toast],
  );

  // An id pushed in from the Customers or Dashboard screen opens straight away.
  useEffect(() => {
    if (openInvoiceId === null) return;
    void withInvoice(openInvoiceId, (invoice) => setPreview(invoice));
    onOpened();
  }, [openInvoiceId, withInvoice, onOpened]);

  const reprint = useCallback(
    (row: InvoiceListRow) =>
      withInvoice(row.id, async (invoice) => {
        const result = await api().documents.print(invoice, 'Duplicate Copy');
        if (!result.ok) toast.error(result.message ?? 'Printing failed.');
      }),
    [withInvoice, toast],
  );

  const downloadPdf = useCallback(
    (row: InvoiceListRow) =>
      withInvoice(row.id, async (invoice) => {
        const result = await api().documents.saveAsPdf(invoice);
        if (result.ok && result.data) {
          toast.success('PDF saved.');
          void api().documents.revealFile(result.data.filePath);
        } else if (result.message !== 'Save cancelled.') {
          toast.error(result.message ?? 'The PDF could not be created.');
        }
      }),
    [withInvoice, toast],
  );

  const shareWhatsApp = useCallback(
    (row: InvoiceListRow) =>
      withInvoice(row.id, async (invoice) => {
        const result = await api().whatsapp.share(invoice);
        if (!result.ok) toast.error(result.message ?? 'WhatsApp sharing failed.');
        else if (result.data?.mode === 'cloud-api') toast.success('Invoice sent on WhatsApp.');
        else toast.info('WhatsApp opened — the PDF is highlighted for you to attach.');
      }),
    [withInvoice, toast],
  );

  const editInvoice = useCallback(
    (row: InvoiceListRow) =>
      withInvoice(row.id, async (invoice) => {
        const editable = await api().invoices.canEdit(row.id);
        if (!editable) {
          toast.error(
            "Only today's invoices can be edited. Duplicate it or cancel and re-bill instead.",
          );
          return;
        }
        onEditInvoice(invoice);
      }),
    [withInvoice, onEditInvoice, toast],
  );

  const duplicate = useCallback(
    async (row: InvoiceListRow) => {
      setBusyId(row.id);
      try {
        const result = await api().invoices.duplicate(row.id);
        if (!result.ok || !result.data) {
          toast.error(result.message ?? 'The invoice could not be duplicated.');
          return;
        }
        toast.info(`Copied to new invoice ${result.data.invoiceNo}.`);
        onEditInvoice(result.data);
      } finally {
        setBusyId(null);
      }
    },
    [onEditInvoice, toast],
  );

  const confirmCancel = useCallback(async () => {
    if (!cancelling) return;
    const result = await api().invoices.cancel(cancelling.id);
    if (!result.ok) {
      toast.error(result.message ?? 'The invoice could not be cancelled.');
      return;
    }
    toast.success(`Invoice ${cancelling.invoiceNo} cancelled.`);
    setCancelling(null);
    await refresh();
  }, [cancelling, refresh, toast]);

  const total = rows
    .filter((row) => row.status !== 'cancelled')
    .reduce((sum, row) => sum + row.grandTotal, 0);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <h2 className="card-title">Invoice History</h2>
            <input
              className="input"
              style={{ maxWidth: 300 }}
              placeholder="Invoice no, customer or mobile…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="select"
              style={{ maxWidth: 150 }}
              value={rangeIndex}
              onChange={(event) => applyRange(Number(event.target.value))}
            >
              {RANGES.map((range, index) => (
                <option key={range.label} value={index}>
                  {range.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ maxWidth: 150 }}
              type="date"
              value={fromDate}
              aria-label="From date"
              onChange={(event) => setFromDate(event.target.value)}
            />
            <input
              className="input"
              style={{ maxWidth: 150 }}
              type="date"
              value={toDate}
              aria-label="To date"
              onChange={(event) => setToDate(event.target.value)}
            />
            <select
              className="select"
              style={{ maxWidth: 130 }}
              value={paymentMode}
              aria-label="Payment mode"
              onChange={(event) => setPaymentMode(event.target.value as PaymentMode | '')}
            >
              <option value="">All payments</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="Online">Online</option>
            </select>
          </div>

          <div className="card-body tight">
            {loading ? (
              <div className="empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="empty">
                <div className="empty-title">No invoices found</div>
                <div>Try a wider date range or clear the search.</div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th className="num">Items</th>
                    <th className="num">Amount</th>
                    <th>Payment</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} style={{ opacity: row.status === 'cancelled' ? 0.55 : 1 }}>
                      <td className="mono">
                        <strong>{row.invoiceNo}</strong>
                        {row.status === 'cancelled' ? (
                          <span className="badge cancelled" style={{ marginLeft: 6 }}>
                            Cancelled
                          </span>
                        ) : null}
                      </td>
                      <td className="nowrap">{formatDisplayDate(row.invoiceDate)}</td>
                      <td>
                        {row.customerName || '—'}
                        {row.customerMobile ? (
                          <div className="hint mono">{row.customerMobile}</div>
                        ) : null}
                      </td>
                      <td className="num">{row.itemCount}</td>
                      <td className="num">
                        <strong>{formatCurrency(row.grandTotal)}</strong>
                      </td>
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
                            disabled={busyId === row.id}
                            onClick={() => void withInvoice(row.id, setPreview)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === row.id}
                            onClick={() => void reprint(row)}
                          >
                            Reprint
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === row.id}
                            onClick={() => void downloadPdf(row)}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === row.id}
                            onClick={() => void shareWhatsApp(row)}
                          >
                            WhatsApp
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busyId === row.id}
                            onClick={() => void duplicate(row)}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busyId === row.id || row.status === 'cancelled'}
                            onClick={() => void editInvoice(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busyId === row.id || row.status === 'cancelled'}
                            onClick={() => setCancelling(row)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {rows.length > 0 ? (
            <div className="items-foot">
              <span>
                {rows.length} invoice{rows.length === 1 ? '' : 's'}
              </span>
              <div className="totals-inline">
                <span>
                  Total <b>{formatCurrency(total)}</b>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {preview ? (
        <PrintPreview
          invoice={preview}
          onClose={() => setPreview(null)}
          onPrint={() => {
            const current = preview;
            setPreview(null);
            void api()
              .documents.print(current, 'Duplicate Copy')
              .then((result) => {
                if (!result.ok) toast.error(result.message ?? 'Printing failed.');
              });
          }}
          onExportPdf={() => {
            const current = preview;
            setPreview(null);
            void api()
              .documents.saveAsPdf(current)
              .then((result) => {
                if (result.ok && result.data) {
                  toast.success('PDF saved.');
                  void api().documents.revealFile(result.data.filePath);
                } else if (result.message !== 'Save cancelled.') {
                  toast.error(result.message ?? 'The PDF could not be created.');
                }
              });
          }}
        />
      ) : null}

      {cancelling ? (
        <ConfirmDialog
          title="Cancel Invoice"
          danger
          confirmLabel="Cancel Invoice"
          message={`Mark invoice ${cancelling.invoiceNo} as cancelled?\n\nIt stays in the records for your GST return but stops counting towards sales.`}
          onCancel={() => setCancelling(null)}
          onConfirm={() => void confirmCancel()}
        />
      ) : null}
    </div>
  );
}
