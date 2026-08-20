import { DEVELOPER } from '@shared/business';
import { useSettings } from '../lib/SettingsContext';
import { Modal } from './Modal';

/**
 * About box. Carries the developer credit — this is the appropriate place for
 * it, along with the manual and the install guide. It never appears on a
 * customer's invoice.
 */
export function AboutDialog({ version, onClose }: { version: string; onClose(): void }) {
  const { settings } = useSettings();
  const { shop } = settings;

  const address = [shop.addressLine1, shop.addressLine2, `${shop.city} ${shop.pincode}`.trim()]
    .filter((line) => line.trim().length > 0)
    .join(', ');

  return (
    <Modal
      title="About this software"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span className="brand-mark" style={{ width: 46, height: 46, fontSize: 20 }}>
          PJ
        </span>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 600,
              color: 'var(--brand)',
              lineHeight: 1.1,
            }}
          >
            {shop.shopName}
          </div>
          <div className="hint">Billing Software · Version {version || '1.0.0'}</div>
        </div>
      </div>

      <div className="section-title">Business</div>
      <table className="table" style={{ marginBottom: 18 }}>
        <tbody>
          <tr>
            <td className="muted" style={{ width: 120 }}>Address</td>
            <td>{address || <span className="muted">Not yet set</span>}</td>
          </tr>
          <tr>
            <td className="muted">GSTIN</td>
            <td className="mono">{shop.gstin || <span className="muted">Not yet set</span>}</td>
          </tr>
          <tr>
            <td className="muted">Phone</td>
            <td className="mono">{shop.phone || <span className="muted">Not yet set</span>}</td>
          </tr>
        </tbody>
      </table>

      <div className="section-title">Software</div>
      <table className="table">
        <tbody>
          <tr>
            <td className="muted" style={{ width: 120 }}>Developed by</td>
            <td>
              <strong>{DEVELOPER.name}</strong>
            </td>
          </tr>
          <tr>
            <td className="muted">Support mobile</td>
            <td className="mono">{DEVELOPER.mobile}</td>
          </tr>
          <tr>
            <td className="muted">Support email</td>
            <td className="mono">{DEVELOPER.email}</td>
          </tr>
        </tbody>
      </table>

      <p className="hint" style={{ marginTop: 16, marginBottom: 0 }}>
        Business details printed on invoices are fixed in the software and cannot be edited from
        Settings. Contact {DEVELOPER.name} to change them.
      </p>
    </Modal>
  );
}
