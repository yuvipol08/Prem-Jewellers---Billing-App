import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invoice } from '@shared/types';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { api } from './lib/api';
import { useOnlineStatus } from './lib/hooks';
import { useSettings } from './lib/SettingsContext';
import { BillingPage, type BillingPageHandle } from './pages/BillingPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'billing' | 'customers' | 'invoices' | 'dashboard' | 'settings';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'billing', label: 'Billing', hint: '1' },
  { id: 'customers', label: 'Customers', hint: '2' },
  { id: 'invoices', label: 'Invoices', hint: '3' },
  { id: 'dashboard', label: 'Dashboard', hint: '4' },
  { id: 'settings', label: 'Backup & Settings', hint: '5' },
];

const MENU_TO_TAB: Record<string, Tab> = {
  'go-billing': 'billing',
  'go-customers': 'customers',
  'go-invoices': 'invoices',
  'go-dashboard': 'dashboard',
  'go-settings': 'settings',
  'open-settings': 'settings',
};

export function App() {
  const { settings, loading } = useSettings();
  const online = useOnlineStatus();

  const [tab, setTab] = useState<Tab>('billing');
  const [pendingInvoice, setPendingInvoice] = useState<Invoice | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [version, setVersion] = useState('');
  // Bumped whenever data changes, so list screens reload when they come forward.
  const [dataToken, setDataToken] = useState(0);

  const billingHandle = useRef<BillingPageHandle | null>(null);
  const registerHandle = useCallback((handle: BillingPageHandle) => {
    billingHandle.current = handle;
  }, []);

  const invalidate = useCallback(() => setDataToken((token) => token + 1), []);

  useEffect(() => {
    void api().app.getVersion().then(setVersion);
  }, []);

  const openInBilling = useCallback((invoice: Invoice) => {
    setPendingInvoice(invoice);
    setTab('billing');
  }, []);

  const viewInvoice = useCallback((id: number) => {
    setOpenInvoiceId(id);
    setTab('invoices');
  }, []);

  // ------------------------------------------------- menu + global shortcuts

  const runAction = useCallback(
    (action: string) => {
      const target = MENU_TO_TAB[action];
      if (target) {
        setTab(target);
        return;
      }
      if (action === 'show-shortcuts') {
        setShowShortcuts(true);
        return;
      }

      // Everything else belongs to the billing screen.
      const handle = billingHandle.current;
      if (!handle) return;
      setTab('billing');

      switch (action) {
        case 'new-invoice':
          handle.newInvoice();
          break;
        case 'save-invoice':
          handle.save();
          break;
        case 'save-and-print':
          handle.saveAndPrint();
          break;
        case 'preview-invoice':
          handle.preview();
          break;
        case 'print-invoice':
          handle.print();
          break;
        case 'export-pdf':
          handle.exportPdf();
          break;
        case 'share-whatsapp':
          handle.shareWhatsApp();
          break;
        default:
          break;
      }
    },
    [],
  );

  useEffect(() => api().on('menu-action', runAction), [runAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;

      if (event.key === 'F1') {
        event.preventDefault();
        setShowShortcuts((open) => !open);
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        runAction('new-invoice');
        return;
      }
      // Alt+N adds an item line without stealing the browser's Ctrl+N.
      if (event.altKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        document.querySelector<HTMLElement>('.items-foot .btn')?.click();
        return;
      }
      if (!modifier) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        // One action, not save-then-print: firing both independently let print
        // re-enter save before the first had returned an invoice number.
        runAction('save-and-print');
        return;
      }

      const tabIndex = Number(event.key);
      if (tabIndex >= 1 && tabIndex <= TABS.length) {
        event.preventDefault();
        setTab(TABS[tabIndex - 1].id);
        return;
      }

      switch (event.key.toLowerCase()) {
        case 's':
          event.preventDefault();
          runAction('save-invoice');
          break;
        case 'p':
          event.preventDefault();
          runAction(event.shiftKey ? 'preview-invoice' : 'print-invoice');
          break;
        case 'e':
          event.preventDefault();
          runAction('export-pdf');
          break;
        case 'w':
          event.preventDefault();
          runAction('share-whatsapp');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runAction]);

  if (loading) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 'auto' }}>
          Opening the billing book…
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">PJ</span>
          <div>
            <div className="brand-name">{settings.shop.shopName}</div>
            <div className="brand-sub">
              {settings.shop.city}
              {settings.shop.gstin ? ` · GSTIN ${settings.shop.gstin}` : ''}
            </div>
          </div>
        </div>

        <div className="header-spacer" />

        <div className="header-meta">
          <span className={`status-dot${online ? '' : ' offline'}`}>
            {online ? 'Online' : 'Offline — billing continues'}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowShortcuts(true)}>
            Shortcuts <kbd>F1</kbd>
          </button>
          {version ? <span className="muted">v{version}</span> : null}
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`nav-tab${tab === entry.id ? ' active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            <kbd>{entry.hint}</kbd>
          </button>
        ))}
      </nav>

      <main className="app-body">
        {/*
          The billing screen stays mounted so an in-progress bill survives a trip
          to another tab — a half-typed invoice must never be lost to a stray click.
        */}
        <div style={{ display: tab === 'billing' ? 'contents' : 'none' }}>
          <BillingPage
            loadInvoice={pendingInvoice}
            onInvoiceLoaded={() => setPendingInvoice(null)}
            registerHandle={registerHandle}
            onSaved={invalidate}
          />
        </div>

        {tab === 'customers' ? <CustomersPage onOpenInvoice={viewInvoice} /> : null}
        {tab === 'invoices' ? (
          <InvoicesPage
            onEditInvoice={openInBilling}
            openInvoiceId={openInvoiceId}
            onOpened={() => setOpenInvoiceId(null)}
            refreshToken={dataToken}
          />
        ) : null}
        {tab === 'dashboard' ? (
          <DashboardPage onOpenInvoice={viewInvoice} refreshToken={dataToken} />
        ) : null}
        {tab === 'settings' ? <SettingsPage onDataChanged={invalidate} /> : null}
      </main>

      {showShortcuts ? <ShortcutsHelp onClose={() => setShowShortcuts(false)} /> : null}
    </div>
  );
}
