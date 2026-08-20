import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invoice } from '@shared/types';
import { api } from '../lib/api';
import { Modal } from './Modal';

interface PrintPreviewProps {
  invoice: Invoice;
  copyLabel?: string;
  onClose(): void;
  onPrint(): void;
  onExportPdf(): void;
}

/** A4 portrait at 96dpi — the sheet size the template renders at. */
const SHEET_WIDTH = 794;
const SHEET_HEIGHT = 1123;

/**
 * Shows the exact HTML that the printer and the PDF exporter will render.
 *
 * The frame carries `allow-same-origin` deliberately. With a bare `sandbox=""`
 * the document gets an opaque origin, and Chromium then drops its inline
 * `<style>` block even though the page CSP allows `'unsafe-inline'` — the
 * invoice rendered completely unstyled, which read as a blank preview. Scripts
 * stay blocked (no `allow-scripts`), and every value on the page is escaped
 * before it gets here, so the document cannot do anything but paint itself.
 */
export function PrintPreview({ invoice, copyLabel, onClose, onPrint, onExportPdf }: PrintPreviewProps) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .documents.previewHtml(invoice, copyLabel)
      .then((markup) => {
        if (!cancelled) setHtml(markup);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [invoice, copyLabel]);

  /** Scales the sheet so a whole A4 page is visible without side-scrolling. */
  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const available = stage.clientWidth - 32;
    setScale(Math.min(1, Math.max(0.35, available / SHEET_WIDTH)));
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit, html]);

  return (
    <Modal
      title="Print Preview — A4"
      onClose={onClose}
      wide
      flush
      footer={
        <>
          <span className="preview-hint">
            Shown at {Math.round(scale * 100)}% — prints at full A4 size
          </span>
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
        <div className="preview-stage" ref={stageRef}>
          <div
            className="preview-sheet"
            style={{
              width: SHEET_WIDTH * scale,
              height: SHEET_HEIGHT * scale,
            }}
          >
            <iframe
              className="preview-frame"
              title="Invoice preview"
              sandbox="allow-same-origin"
              srcDoc={html}
              style={{
                width: SHEET_WIDTH,
                height: SHEET_HEIGHT,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
