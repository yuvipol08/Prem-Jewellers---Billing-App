import { useEffect, useState } from 'react';
import type { Invoice } from '@shared/types';
import { api } from '../lib/api';
import { Modal } from './Modal';

interface PrintPreviewProps {
  invoice: Invoice;
  onClose(): void;
  onPrint(): void;
  onExportPdf(): void;
}

/**
 * Shows the exact HTML that the printer and the PDF exporter will render,
 * inside a sandboxed iframe — no scripts, no navigation, just the page.
 */
export function PrintPreview({ invoice, onClose, onPrint, onExportPdf }: PrintPreviewProps) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api()
      .documents.previewHtml(invoice)
      .then((markup) => {
        if (!cancelled) setHtml(markup);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  return (
    <Modal
      title="Print Preview — A4"
      onClose={onClose}
      wide
      flush
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={onExportPdf}>
            Save PDF
          </button>
          <button type="button" className="btn btn-primary" onClick={onPrint}>
            Print
          </button>
        </>
      }
    >
      {error ? (
        <div className="empty">
          <div className="empty-title">Preview failed</div>
          <div>{error}</div>
        </div>
      ) : (
        <iframe
          className="preview-frame"
          title="Invoice preview"
          sandbox=""
          srcDoc={html}
        />
      )}
    </Modal>
  );
}
