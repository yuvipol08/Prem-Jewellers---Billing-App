import { useState } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until this phrase is typed. */
  requirePhrase?: string;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requirePhrase,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const phraseMatches = !requirePhrase || typed.trim().toUpperCase() === requirePhrase.toUpperCase();

  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || !phraseMatches}
          >
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{message}</p>
      {requirePhrase ? (
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="confirm-phrase">
            Type <strong>{requirePhrase}</strong> to confirm
          </label>
          <input
            id="confirm-phrase"
            className="input"
            value={typed}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={requirePhrase}
          />
        </div>
      ) : null}
    </Modal>
  );
}
