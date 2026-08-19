import { useCallback, useEffect, useState } from 'react';
import { EMERGENCY_CONFIRMATION_PHRASE } from '@shared/api';
import { STATE_CODES } from '@shared/defaults';
import type { AppSettings, CloudStatus, MakingChargeMode } from '@shared/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useSettings } from '../lib/SettingsContext';
import { useToast } from '../lib/useToast';

type Section = 'shop' | 'invoice' | 'backup' | 'cloud' | 'whatsapp' | 'emergency';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'shop', label: 'Shop Details' },
  { id: 'invoice', label: 'Invoice & Printing' },
  { id: 'backup', label: 'Offline Backup' },
  { id: 'cloud', label: 'Cloud Backup' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'emergency', label: 'Emergency' },
];

export function SettingsPage({ onDataChanged }: { onDataChanged(): void }) {
  const { settings, save } = useSettings();
  const toast = useToast();

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [section, setSection] = useState<Section>('shop');
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [dataPath, setDataPath] = useState('');

  useEffect(() => setDraft(settings), [settings]);

  const refreshCloud = useCallback(async () => {
    setCloud(await api().backup.cloudStatus());
  }, []);

  useEffect(() => {
    void refreshCloud();
    void api().app.getDataPath().then(setDataPath);
  }, [refreshCloud]);

  const patchShop = (changes: Partial<AppSettings['shop']>) =>
    setDraft((current) => ({ ...current, shop: { ...current.shop, ...changes } }));
  const patchFirebase = (changes: Partial<AppSettings['firebase']>) =>
    setDraft((current) => ({ ...current, firebase: { ...current.firebase, ...changes } }));
  const patchWhatsApp = (changes: Partial<AppSettings['whatsapp']>) =>
    setDraft((current) => ({ ...current, whatsapp: { ...current.whatsapp, ...changes } }));

  const persist = useCallback(async () => {
    setBusy(true);
    try {
      const result = await save(draft);
      if (result.ok) {
        toast.success('Settings saved.');
        await refreshCloud();
      } else {
        toast.error(result.message ?? 'Settings could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }, [draft, save, toast, refreshCloud]);

  /** Wraps a backup action with a spinner and a single place for error reporting. */
  const run = useCallback(
    async (label: string, action: () => Promise<{ ok: boolean; message?: string }>) => {
      setBusy(true);
      try {
        const result = await action();
        if (result.ok) toast.success(`${label} complete.`);
        else if (!/cancelled/i.test(result.message ?? '')) {
          toast.error(result.message ?? `${label} failed.`);
        }
        return result.ok;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const doEmergency = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api().backup.emergency(EMERGENCY_CONFIRMATION_PHRASE);
      if (!result.ok) {
        toast.error(result.message ?? 'Emergency backup failed. Nothing was deleted.');
        return;
      }
      const report = result.data!;
      toast.success(
        `${report.uploadedInvoices} invoices and ${report.uploadedCustomers} customers are safe in the cloud. This device has been cleared.`,
      );
      setConfirmEmergency(false);
      onDataChanged();
      await refreshCloud();
    } finally {
      setBusy(false);
    }
  }, [toast, onDataChanged, refreshCloud]);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="card-head" style={{ gap: 4, flexWrap: 'wrap' }}>
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`btn btn-sm${section === entry.id ? ' btn-primary' : ' btn-ghost'}`}
                onClick={() => setSection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="card-body">
            {section === 'shop' ? (
              <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="shop-name">Shop Name</label>
                  <input
                    id="shop-name"
                    className="input strong"
                    value={draft.shop.shopName}
                    onChange={(event) => patchShop({ shopName: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="shop-tagline">Tagline</label>
                  <input
                    id="shop-tagline"
                    className="input"
                    value={draft.shop.tagline}
                    onChange={(event) => patchShop({ tagline: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="addr1">Address Line 1</label>
                  <input
                    id="addr1"
                    className="input"
                    value={draft.shop.addressLine1}
                    onChange={(event) => patchShop({ addressLine1: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="addr2">Address Line 2</label>
                  <input
                    id="addr2"
                    className="input"
                    value={draft.shop.addressLine2}
                    onChange={(event) => patchShop({ addressLine2: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="city">City</label>
                  <input
                    id="city"
                    className="input"
                    value={draft.shop.city}
                    onChange={(event) => patchShop({ city: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="state">State</label>
                  <select
                    id="state"
                    className="select"
                    value={draft.shop.stateCode}
                    onChange={(event) => {
                      const found = STATE_CODES.find((s) => s.code === event.target.value);
                      patchShop({
                        stateCode: event.target.value,
                        stateName: found?.name ?? draft.shop.stateName,
                      });
                    }}
                  >
                    {STATE_CODES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.code} — {state.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pincode">PIN Code</label>
                  <input
                    id="pincode"
                    className="input mono"
                    value={draft.shop.pincode}
                    onChange={(event) => patchShop({ pincode: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="phone">Phone</label>
                  <input
                    id="phone"
                    className="input mono"
                    value={draft.shop.phone}
                    onChange={(event) => patchShop({ phone: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    className="input"
                    value={draft.shop.email}
                    onChange={(event) => patchShop({ email: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="gstin">GSTIN</label>
                  <input
                    id="gstin"
                    className="input mono"
                    maxLength={15}
                    value={draft.shop.gstin}
                    onChange={(event) => patchShop({ gstin: event.target.value.toUpperCase() })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pan">PAN</label>
                  <input
                    id="pan"
                    className="input mono"
                    maxLength={10}
                    value={draft.shop.pan}
                    onChange={(event) => patchShop({ pan: event.target.value.toUpperCase() })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="bank">Bank Name</label>
                  <input
                    id="bank"
                    className="input"
                    value={draft.shop.bankName}
                    onChange={(event) => patchShop({ bankName: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="account">Account No</label>
                  <input
                    id="account"
                    className="input mono"
                    value={draft.shop.bankAccount}
                    onChange={(event) => patchShop({ bankAccount: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ifsc">IFSC</label>
                  <input
                    id="ifsc"
                    className="input mono"
                    value={draft.shop.bankIfsc}
                    onChange={(event) => patchShop({ bankIfsc: event.target.value.toUpperCase() })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="upi">UPI ID</label>
                  <input
                    id="upi"
                    className="input mono"
                    value={draft.shop.upiId}
                    onChange={(event) => patchShop({ upiId: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="theme">Appearance</label>
                  <select
                    id="theme"
                    className="select"
                    value={draft.shop.theme}
                    onChange={(event) =>
                      patchShop({ theme: event.target.value as 'light' | 'dark' })
                    }
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </div>
            ) : null}

            {section === 'invoice' ? (
              <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="field">
                  <label htmlFor="prefix">Invoice Prefix</label>
                  <input
                    id="prefix"
                    className="input mono"
                    value={draft.shop.invoicePrefix}
                    onChange={(event) => patchShop({ invoicePrefix: event.target.value })}
                  />
                  <span className="hint">
                    Numbers look like{' '}
                    <strong className="mono">
                      {draft.shop.resetNumberYearly
                        ? `${draft.shop.invoicePrefix}/25-26/0001`
                        : `${draft.shop.invoicePrefix}-0001`}
                    </strong>
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="start-no">Start Number</label>
                  <input
                    id="start-no"
                    className="input num"
                    type="number"
                    min="1"
                    value={draft.shop.invoiceStartNumber}
                    onChange={(event) =>
                      patchShop({ invoiceStartNumber: Number(event.target.value) || 1 })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="reset-yearly">Numbering</label>
                  <select
                    id="reset-yearly"
                    className="select"
                    value={draft.shop.resetNumberYearly ? 'yes' : 'no'}
                    onChange={(event) =>
                      patchShop({ resetNumberYearly: event.target.value === 'yes' })
                    }
                  >
                    <option value="yes">Restart each financial year</option>
                    <option value="no">Continuous</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="gst-rate">Default GST Rate (%)</label>
                  <input
                    id="gst-rate"
                    className="input num"
                    type="number"
                    min="0"
                    step="0.5"
                    value={draft.shop.defaultGstRate}
                    onChange={(event) =>
                      patchShop({ defaultGstRate: Number(event.target.value) || 0 })
                    }
                  />
                  <span className="hint">Gold and silver jewellery is 3%.</span>
                </div>
                <div className="field">
                  <label htmlFor="hsn">Default HSN Code</label>
                  <input
                    id="hsn"
                    className="input mono"
                    value={draft.shop.defaultHsnCode}
                    onChange={(event) => patchShop({ defaultHsnCode: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="mc-mode">Default Making Charge</label>
                  <select
                    id="mc-mode"
                    className="select"
                    value={draft.shop.defaultMakingChargeMode}
                    onChange={(event) =>
                      patchShop({
                        defaultMakingChargeMode: event.target.value as MakingChargeMode,
                      })
                    }
                  >
                    <option value="flat">Flat amount (₹)</option>
                    <option value="per_gram">Per gram (₹/g)</option>
                    <option value="percent">Percent of metal value (%)</option>
                  </select>
                </div>
                <div className="field" style={{ gridColumn: 'span 3' }}>
                  <label htmlFor="terms">Terms &amp; Conditions (printed on the bill)</label>
                  <textarea
                    id="terms"
                    className="textarea"
                    value={draft.shop.termsAndConditions}
                    onChange={(event) => patchShop({ termsAndConditions: event.target.value })}
                  />
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="declaration">Declaration</label>
                  <textarea
                    id="declaration"
                    className="textarea"
                    value={draft.shop.declaration}
                    onChange={(event) => patchShop({ declaration: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sign-label">Signature Label</label>
                  <input
                    id="sign-label"
                    className="input"
                    value={draft.shop.signatureLabel}
                    onChange={(event) => patchShop({ signatureLabel: event.target.value })}
                  />
                </div>
              </div>
            ) : null}

            {section === 'backup' ? (
              <div>
                <p className="hint" style={{ marginTop: 0 }}>
                  Every bill is stored on this computer at{' '}
                  <span className="mono">{dataPath || '…'}</span>. Offline backups are plain
                  JSON files you can copy to a pen drive.
                </p>

                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void run('Backup', () => api().backup.exportLocal()).then((ok) => {
                        if (ok) onDataChanged();
                      })
                    }
                  >
                    Save Backup File
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setConfirmRestore(true)}
                  >
                    Restore From File
                  </button>
                </div>

                <div className="divider" />

                <div className="field-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
                  <div className="field">
                    <label htmlFor="backup-folder">Automatic Backup Folder</label>
                    <input
                      id="backup-folder"
                      className="input"
                      readOnly
                      value={draft.shop.localBackupFolder || 'Not set'}
                    />
                  </div>
                  <div className="field">
                    <label>&nbsp;</label>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        const result = await api().backup.chooseFolder();
                        if (result.ok && result.data) {
                          patchShop({ localBackupFolder: result.data.folder });
                        }
                      }}
                    >
                      Choose Folder…
                    </button>
                  </div>
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor="auto-backup">On Closing the App</label>
                    <select
                      id="auto-backup"
                      className="select"
                      value={draft.shop.autoBackupOnExit ? 'yes' : 'no'}
                      onChange={(event) =>
                        patchShop({ autoBackupOnExit: event.target.value === 'yes' })
                      }
                    >
                      <option value="no">Do nothing</option>
                      <option value="yes">Write a backup to the folder above</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : null}

            {section === 'cloud' ? (
              <div>
                <p className="hint" style={{ marginTop: 0 }}>
                  Cloud backup uses your own Firebase project. Billing never waits for the
                  internet — uploads happen only when you ask for them.
                </p>

                <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="field">
                    <label htmlFor="fb-enabled">Cloud Backup</label>
                    <select
                      id="fb-enabled"
                      className="select"
                      value={draft.firebase.enabled ? 'on' : 'off'}
                      onChange={(event) =>
                        patchFirebase({ enabled: event.target.value === 'on' })
                      }
                    >
                      <option value="off">Off</option>
                      <option value="on">On</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="fb-project">Firebase Project ID</label>
                    <input
                      id="fb-project"
                      className="input mono"
                      value={draft.firebase.projectId}
                      onChange={(event) => patchFirebase({ projectId: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fb-key">Web API Key</label>
                    <input
                      id="fb-key"
                      className="input mono"
                      value={draft.firebase.apiKey}
                      onChange={(event) => patchFirebase({ apiKey: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fb-namespace">Namespace</label>
                    <input
                      id="fb-namespace"
                      className="input mono"
                      value={draft.firebase.namespace}
                      onChange={(event) => patchFirebase({ namespace: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fb-email">Backup Account Email</label>
                    <input
                      id="fb-email"
                      className="input"
                      autoComplete="off"
                      value={draft.firebase.email}
                      onChange={(event) => patchFirebase({ email: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fb-password">Password</label>
                    <input
                      id="fb-password"
                      className="input"
                      type="password"
                      autoComplete="off"
                      value={draft.firebase.password}
                      onChange={(event) => patchFirebase({ password: event.target.value })}
                    />
                  </div>
                </div>

                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void run('Connection test', () => api().backup.testCloud())}
                  >
                    Test Connection
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void run('Cloud backup', () => api().backup.cloudBackup()).then(refreshCloud)
                    }
                  >
                    Back Up Now
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      void run('Cloud restore', () => api().backup.cloudRestore()).then((ok) => {
                        if (ok) onDataChanged();
                        return refreshCloud();
                      })
                    }
                  >
                    Restore From Cloud
                  </button>
                </div>

                {cloud ? (
                  <p className="hint" style={{ marginTop: 12 }}>
                    Last cloud backup: <strong>{formatDateTime(cloud.lastBackupAt)}</strong>
                    {cloud.pendingChanges > 0
                      ? ` · ${cloud.pendingChanges} invoice(s) changed since then`
                      : ' · up to date'}
                  </p>
                ) : null}
              </div>
            ) : null}

            {section === 'whatsapp' ? (
              <div>
                <p className="hint" style={{ marginTop: 0 }}>
                  Without the Cloud API, sharing opens WhatsApp on the customer&apos;s chat with the
                  message ready and highlights the PDF for you to attach. With it configured, the
                  PDF is delivered automatically.
                </p>

                <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="field">
                    <label htmlFor="wa-mode">Sending Mode</label>
                    <select
                      id="wa-mode"
                      className="select"
                      value={draft.whatsapp.useCloudApi ? 'api' : 'link'}
                      onChange={(event) =>
                        patchWhatsApp({ useCloudApi: event.target.value === 'api' })
                      }
                    >
                      <option value="link">Open WhatsApp (manual attach)</option>
                      <option value="api">WhatsApp Cloud API (automatic)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="wa-country">Default Country Code</label>
                    <input
                      id="wa-country"
                      className="input mono"
                      value={draft.whatsapp.defaultCountryCode}
                      onChange={(event) =>
                        patchWhatsApp({ defaultCountryCode: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="wa-phone-id">Phone Number ID</label>
                    <input
                      id="wa-phone-id"
                      className="input mono"
                      disabled={!draft.whatsapp.useCloudApi}
                      value={draft.whatsapp.phoneNumberId}
                      onChange={(event) => patchWhatsApp({ phoneNumberId: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="wa-token">Access Token</label>
                    <input
                      id="wa-token"
                      className="input"
                      type="password"
                      autoComplete="off"
                      disabled={!draft.whatsapp.useCloudApi}
                      value={draft.whatsapp.accessToken}
                      onChange={(event) => patchWhatsApp({ accessToken: event.target.value })}
                    />
                  </div>
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor="wa-template">Message</label>
                    <textarea
                      id="wa-template"
                      className="textarea"
                      value={draft.whatsapp.messageTemplate}
                      onChange={(event) => patchWhatsApp({ messageTemplate: event.target.value })}
                    />
                    <span className="hint">
                      Available: {'{customerName}'} {'{shopName}'} {'{invoiceNo}'} {'{invoiceDate}'}{' '}
                      {'{grandTotal}'}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {section === 'emergency' ? (
              <div>
                <div
                  className="card"
                  style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)' }}
                >
                  <div className="card-body">
                    <h3 style={{ margin: '0 0 8px', color: 'var(--danger)' }}>
                      Emergency Backup &amp; Clear Device
                    </h3>
                    <p style={{ margin: '0 0 10px', lineHeight: 1.65 }}>
                      Uploads every invoice and customer to your cloud account, reads the upload
                      back to prove it arrived intact, and only then erases all business records
                      from this computer. Your shop settings stay, so the app keeps working.
                    </p>
                    <p style={{ margin: '0 0 14px', lineHeight: 1.65 }}>
                      <strong>If the upload or the verification fails, nothing is deleted.</strong>{' '}
                      You can bring everything back later with <em>Restore From Cloud</em>.
                    </p>
                    <button
                      type="button"
                      className="btn btn-danger btn-lg"
                      disabled={busy || !cloud?.configured}
                      onClick={() => setConfirmEmergency(true)}
                    >
                      Emergency Backup &amp; Clear Device
                    </button>
                    {!cloud?.configured ? (
                      <p className="error-text" style={{ marginBottom: 0, marginTop: 10 }}>
                        Set up and test Cloud Backup first — records can only be cleared once they
                        are safely uploaded.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {section !== 'emergency' ? (
            <div className="items-foot">
              <span className="hint">Changes apply to new bills and reprints immediately.</span>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void persist()}
                >
                  {busy ? <span className="spinner" /> : null}
                  Save Settings
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {confirmRestore ? (
        <ConfirmDialog
          title="Restore From Backup File"
          confirmLabel="Choose File…"
          message={
            'Records from the backup file will be merged into this device.\n\n' +
            'Invoices with the same number and customers with the same mobile are updated rather than duplicated.'
          }
          onCancel={() => setConfirmRestore(false)}
          onConfirm={() => {
            setConfirmRestore(false);
            void run('Restore', () => api().backup.importLocal()).then((ok) => {
              if (ok) onDataChanged();
            });
          }}
        />
      ) : null}

      {confirmEmergency ? (
        <ConfirmDialog
          title="Emergency Backup & Clear Device"
          danger
          busy={busy}
          confirmLabel="Upload, Verify & Clear"
          requirePhrase={EMERGENCY_CONFIRMATION_PHRASE}
          message={
            'This will upload every invoice and customer to your cloud account, verify the upload, ' +
            'and then permanently erase all business records from this computer.\n\n' +
            'Nothing is deleted unless the upload is verified first.'
          }
          onCancel={() => setConfirmEmergency(false)}
          onConfirm={() => void doEmergency()}
        />
      ) : null}
    </div>
  );
}
