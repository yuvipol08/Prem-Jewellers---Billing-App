import { useCallback, useEffect, useState } from 'react';
import { STATE_CODES } from '@shared/defaults';
import type { Customer, InvoiceListRow } from '@shared/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { formatCurrency, formatDisplayDate } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { useSettings } from '../lib/SettingsContext';
import { useToast } from '../lib/useToast';

function emptyCustomer(stateCode: string): Customer {
  return {
    name: '',
    mobile: '',
    address: '',
    pan: '',
    gstin: '',
    stateCode,
    notes: '',
  };
}

export function CustomersPage({ onOpenInvoice }: { onOpenInvoice(id: number): void }) {
  const { settings } = useSettings();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [history, setHistory] = useState<InvoiceListRow[]>([]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const term = useDebounced(search, 200);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await api().customers.list(term, 300));
    } finally {
      setLoading(false);
    }
  }, [term]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCustomer = useCallback(async (customer: Customer) => {
    setSelected(customer);
    if (customer.id) setHistory(await api().customers.history(customer.id));
  }, []);

  const saveCustomer = useCallback(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error('Enter the customer name.');
      return;
    }

    const result = await api().customers.save(editing);
    if (!result.ok) {
      toast.error(result.message ?? 'The customer could not be saved.');
      return;
    }

    toast.success(`${editing.name} saved.`);
    setEditing(null);
    await refresh();
  }, [editing, refresh, toast]);

  const confirmDelete = useCallback(async () => {
    if (!deleting?.id) return;
    const result = await api().customers.remove(deleting.id);
    if (!result.ok) {
      toast.error(result.message ?? 'The customer could not be removed.');
      return;
    }
    // Past invoices keep their printed customer details; only the record goes.
    toast.success(`${deleting.name} removed. Their invoices are unchanged.`);
    setDeleting(null);
    if (selected?.id === deleting.id) setSelected(null);
    await refresh();
  }, [deleting, refresh, selected, toast]);

  const totalSpend = history
    .filter((row) => row.status !== 'cancelled')
    .reduce((sum, row) => sum + row.grandTotal, 0);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Customers</h2>
            <input
              className="input"
              style={{ maxWidth: 340, marginLeft: 'auto' }}
              placeholder="Search name, mobile, GSTIN or PAN…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing(emptyCustomer(settings.shop.stateCode))}
            >
              + Add Customer
            </button>
          </div>

          <div className="card-body tight">
            {loading ? (
              <div className="empty">Loading…</div>
            ) : customers.length === 0 ? (
              <div className="empty">
                <div className="empty-title">No customers yet</div>
                <div>Customers are saved automatically every time you bill someone.</div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mobile</th>
                    <th>GSTIN</th>
                    <th>Address</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className={selected?.id === customer.id ? 'selected' : ''}
                      onClick={() => void openCustomer(customer)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <strong>{customer.name}</strong>
                      </td>
                      <td className="mono">{customer.mobile || '—'}</td>
                      <td className="mono">{customer.gstin || '—'}</td>
                      <td className="muted">{customer.address || '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(customer);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleting(customer);
                            }}
                          >
                            Delete
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

      {selected ? (
        <Modal
          title={`${selected.name} — Purchase History`}
          onClose={() => setSelected(null)}
          wide
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <div className="section-title">Mobile</div>
              <div className="mono">{selected.mobile || '—'}</div>
            </div>
            <div>
              <div className="section-title">Total Purchases</div>
              <div className="mono">
                <strong>{formatCurrency(totalSpend)}</strong>
              </div>
            </div>
            <div>
              <div className="section-title">Invoices</div>
              <div className="mono">{history.length}</div>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="empty">No invoices for this customer yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th className="num">Amount</th>
                  <th>Payment</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.invoiceNo}</td>
                    <td>{formatDisplayDate(row.invoiceDate)}</td>
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
                          onClick={() => {
                            setSelected(null);
                            onOpenInvoice(row.id);
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title={editing.id ? 'Edit Customer' : 'Add Customer'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveCustomer()}>
                Save
              </button>
            </>
          }
        >
          <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="edit-name">Name</label>
              <input
                id="edit-name"
                className="input"
                autoFocus
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-mobile">Mobile</label>
              <input
                id="edit-mobile"
                className="input mono"
                value={editing.mobile}
                onChange={(event) => setEditing({ ...editing, mobile: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-state">State</label>
              <select
                id="edit-state"
                className="select"
                value={editing.stateCode}
                onChange={(event) => setEditing({ ...editing, stateCode: event.target.value })}
              >
                {STATE_CODES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} — {state.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="edit-address">Address</label>
              <textarea
                id="edit-address"
                className="textarea"
                value={editing.address}
                onChange={(event) => setEditing({ ...editing, address: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-pan">PAN</label>
              <input
                id="edit-pan"
                className="input mono"
                maxLength={10}
                value={editing.pan}
                onChange={(event) =>
                  setEditing({ ...editing, pan: event.target.value.toUpperCase() })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="edit-gstin">GSTIN</label>
              <input
                id="edit-gstin"
                className="input mono"
                maxLength={15}
                value={editing.gstin}
                onChange={(event) =>
                  setEditing({ ...editing, gstin: event.target.value.toUpperCase() })
                }
              />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="edit-notes">Notes</label>
              <input
                id="edit-notes"
                className="input"
                value={editing.notes}
                onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
              />
            </div>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Remove Customer"
          danger
          confirmLabel="Remove"
          message={`Remove ${deleting.name} from the customer list?\n\nTheir past invoices stay exactly as they were printed.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
