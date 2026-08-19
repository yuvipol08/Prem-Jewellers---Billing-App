import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { hasApi } from './lib/api';
import { SettingsProvider } from './lib/SettingsContext';
import { ToastProvider } from './lib/useToast';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html.');

const root = createRoot(container);

if (!hasApi()) {
  // Opened outside Electron (e.g. the bare Vite URL in a browser).
  root.render(
    <div className="empty" style={{ paddingTop: 120 }}>
      <div className="empty-title">Prem Jewellers Billing</div>
      <div>Please open this application from the desktop app.</div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <ToastProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </ToastProvider>
    </StrictMode>,
  );
}
