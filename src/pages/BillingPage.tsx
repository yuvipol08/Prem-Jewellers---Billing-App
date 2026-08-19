import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeInvoice, isSameState } from '@shared/calc';
import { createEmptyInvoice, createEmptyItem, STATE_CODES } from '@shared/defaults';
import type { Customer, Invoice, InvoiceItem, PaymentMode } from '@shared/types';
import { CustomerPicker } from '../components/CustomerPicker';
import { ItemsTable } from '../components/ItemsTable';
import { PrintPreview } from '../components/PrintPreview';
import { api } from '../lib/api';
import { formatCurrency, formatGrams } from '../lib/format';
import { useSettings } from '../lib/SettingsContext';
import { useToast } from '../lib/useToast';
import '../styles/billing.css';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Cheque', 'Online'];

export interface BillingPageHandle {
  newInvoice(): void;
  save(): void;
  saveAndPrint(): void;
  preview(): void;
  print(): void;
  exportPdf(): void;
  shareWhatsApp(): void;
}

interface BillingPageProps {
  /** An invoice pushed in from the Invoices tab for edit or duplication. */
  loadInvoice: Invoice | null;
  onInvoiceLoaded(): void;
  registerHandle(handle: BillingPageHandle): void;
  onSaved(): void;
}

export function BillingPage({
  loadInvoice,
  onInvoiceLoaded,
  registerHandle,
  onSaved,
}: BillingPageProps) {
  const { settings } = useSettings();
  const toast = useToast();

  const [invoice, setInvoice] = useState<Invoice>(() => createEmptyInvoice('', settings.shop));
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const customerFieldRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef<Promise<Invoice | null> | null>(null);
  /**
   * The invoice exactly as it currently exists in the database, or null when it
   * is unsaved or has been edited since. A ref rather than state because the
   * output actions read it *after* an await, where a render closure would still
   * be holding the pre-save value and would save the bill a second time.
   */
  const persistedRef = useRef<Invoice | null>(null);

  const computed = useMemo(() => computeInvoice(invoice), [invoice]);
  const isEditing = Boolean(invoice.id);
  const hasItems = computed.items.length > 0;

  // ------------------------------------------------------------ new invoice

  const startNewInvoice = useCallback(async () => {
    const invoiceNo = await api().invoices.nextNumber();
    setInvoice(createEmptyInvoice(invoiceNo, settings.shop));
    setDirty(false);
    persistedRef.current = null;
    requestAnimationFrame(() => customerFieldRef.current?.focus());
  }, [settings.shop]);

  useEffect(() => {
    void startNewInvoice();
    // Only on first mount: later shop-setting edits must not wipe an open bill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadInvoice) return;
    setInvoice(loadInvoice);
    setDirty(false);
    // A bill arriving from the Invoices tab is already stored unless it is a
    // duplicate, which arrives without an id.
    persistedRef.current = loadInvoice.id ? loadInvoice : null;
    onInvoiceLoaded();
  }, [loadInvoice, onInvoiceLoaded]);

  // --------------------------------------------------------------- editing

  const patch = useCallback((changes: Partial<Invoice>) => {
    setInvoice((current) => ({ ...current, ...changes }));
    setDirty(true);
    persistedRef.current = null;
  }, []);

  const patchItem = useCallback((index: number, changes: Partial<InvoiceItem>) => {
    setInvoice((current) => {
      const items = current.items.map((item, position) =>
        position === index ? { ...item, ...changes } : item,
      );
      return { ...current, items };
    });
    setDirty(true);
    persistedRef.current = null;
  }, []);

  const addRow = useCallback(() => {
    setInvoice((current) => ({
      ...current,
      items: [...current.items, createEmptyItem(settings.shop)],
    }));
    persistedRef.current = null;
  }, [settings.shop]);

  const removeRow = useCallback(
    (index: number) => {
      setInvoice((current) => {
        const items = current.items.filter((_, position) => position !== index);
        // Never leave the grid empty — there must always be somewhere to type.
        return { ...current, items: items.length ? items : [createEmptyItem(settings.shop)] };
      });
      setDirty(true);
      persistedRef.current = null;
    },
    [settings.shop],
  );

  const applyCustomer = useCallback(
    (customer: Customer) => {
      patch({
        customerId: customer.id ?? null,
        customerName: customer.name,
        customerMobile: customer.mobile,
        customerAddress: customer.address,
        customerPan: customer.pan,
        customerGstin: customer.gstin,
        customerStateCode: customer.stateCode || settings.shop.stateCode,
        intraState: isSameState(settings.shop.stateCode, customer.stateCode),
      });
      toast.info(`Loaded ${customer.name}`);
    },
    [patch, settings.shop.stateCode, toast],
  );

  const setStateCode = useCallback(
    (stateCode: string) => {
      patch({
        customerStateCode: stateCode,
        intraState: isSameState(settings.shop.stateCode, stateCode),
      });
    },
    [patch, settings.shop.stateCode],
  );

  // ---------------------------------------------------------------- actions

  const validate = useCallback((): string | null => {
    if (!invoice.customerName.trim()) return 'Enter the customer name.';
    if (!hasItems) return 'Add at least one item with a weight or amount.';
    return null;
  }, [invoice.customerName, hasItems]);

  /**
   * Saves the bill and, when the customer is new, files them in the database too.
   *
   * Concurrent calls share one in-flight promise. Without that, a shortcut that
   * triggers save and print together would let print re-enter save before the
   * first had returned an invoice number, writing the same bill twice under two
   * different numbers.
   */
  const save = useCallback((): Promise<Invoice | null> => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return Promise.resolve(null);
    }

    if (savingRef.current) return savingRef.current;

    const run = async (): Promise<Invoice | null> => {
    setBusy(true);
    try {
      let customerId = invoice.customerId;
      if (invoice.customerName.trim()) {
        const saved = await api().customers.save({
          id: customerId ?? undefined,
          name: invoice.customerName,
          mobile: invoice.customerMobile,
          address: invoice.customerAddress,
          pan: invoice.customerPan,
          gstin: invoice.customerGstin,
          stateCode: invoice.customerStateCode,
          notes: '',
        });
        if (saved.ok && saved.data?.id) customerId = saved.data.id;
      }

      const toSave: Invoice = { ...invoice, customerId };
      const result = await api().invoices.save(toSave);

      if (!result.ok || !result.data) {
        toast.error(result.message ?? 'The invoice could not be saved.');
        return null;
      }

      const stored: Invoice = {
        ...toSave,
        id: result.data.id,
        invoiceNo: result.data.invoiceNo,
      };
      setInvoice(stored);
      setDirty(false);
      persistedRef.current = stored;
      onSaved();
      toast.success(`Invoice ${result.data.invoiceNo} saved.`);
      return stored;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
    };

    const inFlight = run();
    savingRef.current = inFlight;
    void inFlight.finally(() => {
      savingRef.current = null;
    });
    return inFlight;
  }, [invoice, validate, toast, onSaved]);

  /**
   * Every output action saves first, so a printed bill is always in the books.
   *
   * Reads the ref, not the rendered invoice: after an awaited save the closure
   * still holds the pre-save value, and trusting it would save the same bill
   * twice under two invoice numbers.
   */
  const ensureSaved = useCallback(async (): Promise<Invoice | null> => {
    if (persistedRef.current) return persistedRef.current;
    return save();
  }, [save]);

  const doPreview = useCallback(async () => {
    if (validate()) {
      toast.error(validate()!);
      return;
    }
    setShowPreview(true);
  }, [validate, toast]);

  const doPrint = useCallback(async () => {
    const saved = await ensureSaved();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await api().documents.print(saved);
      if (!result.ok) toast.error(result.message ?? 'Printing failed.');
    } finally {
      setBusy(false);
      setShowPreview(false);
    }
  }, [ensureSaved, toast]);

  const doExportPdf = useCallback(async () => {
    const saved = await ensureSaved();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await api().documents.saveAsPdf(saved);
      if (result.ok && result.data) {
        toast.success('PDF saved.');
        void api().documents.revealFile(result.data.filePath);
      } else if (result.message !== 'Save cancelled.') {
        toast.error(result.message ?? 'The PDF could not be created.');
      }
    } finally {
      setBusy(false);
      setShowPreview(false);
    }
  }, [ensureSaved, toast]);

  const doWhatsApp = useCallback(async () => {
    const saved = await ensureSaved();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await api().whatsapp.share(saved);
      if (!result.ok) {
        toast.error(result.message ?? 'WhatsApp sharing failed.');
      } else if (result.data?.mode === 'cloud-api') {
        toast.success('Invoice sent on WhatsApp.');
      } else {
        toast.info('WhatsApp opened — the PDF is highlighted in your file manager to attach.');
      }
    } finally {
      setBusy(false);
    }
  }, [ensureSaved, toast]);

  const saveAndPrint = useCallback(async () => {
    const saved = await save();
    if (!saved) return;
    // Print the invoice save() just returned rather than going back through
    // ensureSaved, which would re-read state that has not re-rendered yet.
    setBusy(true);
    try {
      const result = await api().documents.print(saved);
      if (!result.ok) toast.error(result.message ?? 'Printing failed.');
    } finally {
      setBusy(false);
    }
  }, [save, toast]);

  // Menu items and global shortcuts drive the same handlers as the buttons.
  useEffect(() => {
    registerHandle({
      newInvoice: () => void startNewInvoice(),
      save: () => void save(),
      saveAndPrint: () => void saveAndPrint(),
      preview: () => void doPreview(),
      print: () => void doPrint(),
      exportPdf: () => void doExportPdf(),
      shareWhatsApp: () => void doWhatsApp(),
    });
  }, [
    registerHandle,
    startNewInvoice,
    save,
    saveAndPrint,
    doPreview,
    doPrint,
    doExportPdf,
    doWhatsApp,
  ]);

  const { totals } = computed;

  return (
    <div className="billing">
      <div className="billing-main">
        {isEditing ? (
          <div className="editing-banner">
            <span>
              Editing saved invoice <strong>{invoice.invoiceNo}</strong>
              {dirty ? ' — unsaved changes' : ''}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void startNewInvoice()}>
              Start New Bill
            </button>
          </div>
        ) : null}

        <div className="card">
          <div className="card-body">
            <div className="invoice-meta">
              <div className="field">
                <label htmlFor="invoice-no">Invoice No</label>
                <input
                  id="invoice-no"
                  className="input strong mono"
                  value={invoice.invoiceNo}
                  onChange={(event) => patch({ invoiceNo: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="invoice-date">Date</label>
                <input
                  id="invoice-date"
                  className="input"
                  type="date"
                  value={invoice.invoiceDate}
                  onChange={(event) => patch({ invoiceDate: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="place-of-supply">Place of Supply</label>
                <select
                  id="place-of-supply"
                  className="select"
                  value={invoice.customerStateCode}
                  onChange={(event) => setStateCode(event.target.value)}
                >
                  {STATE_CODES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.code} — {state.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>GST Type</label>
                <div className="input" style={{ background: 'var(--surface-sunken)' }}>
                  {invoice.intraState ? 'CGST + SGST (Intra-State)' : 'IGST (Inter-State)'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Customer</h2>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              Search by name, mobile or GSTIN — details fill in automatically
            </span>
          </div>
          <div className="card-body">
            <div className="customer-grid">
              <div className="field span-2">
                <label>Name</label>
                <CustomerPicker
                  inputRef={customerFieldRef}
                  value={invoice.customerName}
                  onChange={(value) => patch({ customerName: value, customerId: null })}
                  onPick={applyCustomer}
                />
              </div>
              <div className="field">
                <label htmlFor="cust-mobile">Mobile</label>
                <input
                  id="cust-mobile"
                  className="input mono"
                  value={invoice.customerMobile}
                  inputMode="tel"
                  maxLength={15}
                  onChange={(event) => patch({ customerMobile: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="cust-pan">PAN</label>
                <input
                  id="cust-pan"
                  className="input mono"
                  value={invoice.customerPan}
                  maxLength={10}
                  style={{ textTransform: 'uppercase' }}
                  onChange={(event) => patch({ customerPan: event.target.value.toUpperCase() })}
                />
              </div>
              <div className="field span-2">
                <label htmlFor="cust-address">Address</label>
                <input
                  id="cust-address"
                  className="input"
                  value={invoice.customerAddress}
                  onChange={(event) => patch({ customerAddress: event.target.value })}
                />
              </div>
              <div className="field span-2">
                <label htmlFor="cust-gstin">GSTIN</label>
                <input
                  id="cust-gstin"
                  className="input mono"
                  value={invoice.customerGstin}
                  maxLength={15}
                  style={{ textTransform: 'uppercase' }}
                  onChange={(event) => patch({ customerGstin: event.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Items</h2>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              Press <kbd>Enter</kbd> to move down · <kbd>Alt</kbd>+<kbd>N</kbd> adds a line
            </span>
          </div>
          <div className="card-body tight">
            <ItemsTable
              items={invoice.items}
              onChange={patchItem}
              onRemove={removeRow}
              onAddRow={addRow}
            />
            <div className="items-foot">
              <button type="button" className="btn btn-sm" onClick={addRow}>
                + Add Line
              </button>
              <div className="totals-inline">
                <span>
                  Gross <b>{formatGrams(totals.totalGrossWeight)}</b>
                </span>
                <span>
                  Net <b>{formatGrams(totals.totalNetWeight)}</b>
                </span>
                <span>
                  Making <b>{formatCurrency(totals.totalMakingCharges)}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="billing-side">
        <div className="card totals-card">
          <div className="card-head">
            <h2 className="card-title">Bill Summary</h2>
          </div>
          <div className="card-body">
            <div className="total-row">
              <span className="label">Taxable Value</span>
              <span className="value">{formatCurrency(totals.taxableBeforeDiscount)}</span>
            </div>

            <div className="field" style={{ margin: '8px 0' }}>
              <label htmlFor="discount">Discount (₹)</label>
              <input
                id="discount"
                className="input num"
                type="number"
                min="0"
                step="0.01"
                value={invoice.discount === 0 ? '' : invoice.discount}
                onChange={(event) => patch({ discount: Number(event.target.value) || 0 })}
              />
            </div>

            <div className="total-row divide">
              <span className="label">Net Taxable</span>
              <span className="value">{formatCurrency(totals.taxableValue)}</span>
            </div>

            {invoice.intraState ? (
              <>
                <div className="total-row">
                  <span className="label">CGST</span>
                  <span className="value">{formatCurrency(totals.cgst)}</span>
                </div>
                <div className="total-row">
                  <span className="label">SGST</span>
                  <span className="value">{formatCurrency(totals.sgst)}</span>
                </div>
              </>
            ) : (
              <div className="total-row">
                <span className="label">IGST</span>
                <span className="value">{formatCurrency(totals.igst)}</span>
              </div>
            )}

            <div className="total-row">
              <span className="label">Round Off</span>
              <span className="value">{formatCurrency(totals.roundOff)}</span>
            </div>

            <div className="grand-total">
              <span className="label">Grand Total</span>
              <span className="value">{formatCurrency(totals.grandTotal)}</span>
            </div>

            <div className="words-line">{computed.amountInWords}</div>

            {totals.balance > 0 && invoice.amountPaid > 0 ? (
              <div className="balance-line">
                <span>Balance Due</span>
                <span>{formatCurrency(totals.balance)}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Payment</h2>
          </div>
          <div className="card-body">
            <div className="payment-modes">
              {PAYMENT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-btn${invoice.paymentMode === mode ? ' active' : ''}`}
                  onClick={() => patch({ paymentMode: mode })}
                >
                  {mode}
                </button>
              ))}
            </div>

            {invoice.paymentMode !== 'Cash' ? (
              <div className="field" style={{ marginTop: 11 }}>
                <label htmlFor="payment-ref">
                  {invoice.paymentMode === 'Cheque' ? 'Cheque No / Bank' : 'Transaction Reference'}
                </label>
                <input
                  id="payment-ref"
                  className="input"
                  value={invoice.paymentReference}
                  onChange={(event) => patch({ paymentReference: event.target.value })}
                />
              </div>
            ) : null}

            <div className="field" style={{ marginTop: 11 }}>
              <label htmlFor="amount-paid">Amount Received (₹)</label>
              <input
                id="amount-paid"
                className="input num"
                type="number"
                min="0"
                step="0.01"
                placeholder={String(totals.grandTotal)}
                value={invoice.amountPaid === 0 ? '' : invoice.amountPaid}
                onChange={(event) => patch({ amountPaid: Number(event.target.value) || 0 })}
              />
              <span className="hint">Leave blank if paid in full.</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="action-stack">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => void saveAndPrint()}
                disabled={busy}
              >
                {busy ? <span className="spinner" /> : null}
                Save &amp; Print <kbd>Ctrl+Enter</kbd>
              </button>

              <div className="action-pair">
                <button type="button" className="btn" onClick={() => void save()} disabled={busy}>
                  Save <kbd>Ctrl+S</kbd>
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void doPreview()}
                  disabled={busy}
                >
                  Preview
                </button>
              </div>

              <div className="action-pair">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void doExportPdf()}
                  disabled={busy}
                >
                  Save PDF
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void doWhatsApp()}
                  disabled={busy}
                >
                  WhatsApp
                </button>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void startNewInvoice()}
                disabled={busy}
              >
                New Bill <kbd>F2</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPreview ? (
        <PrintPreview
          invoice={invoice}
          onClose={() => setShowPreview(false)}
          onPrint={() => void doPrint()}
          onExportPdf={() => void doExportPdf()}
        />
      ) : null}
    </div>
  );
}
