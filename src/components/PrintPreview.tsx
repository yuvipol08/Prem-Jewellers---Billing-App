import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PrinterChoice } from '@shared/api';
import { isVirtualPrinter } from '@shared/printers';
import type { Invoice } from '@shared/types';
import { api } from '../lib/api';
import { Modal } from './Modal';

interface PrintPreviewProps {
  invoice: Invoice;
  copyLabel?: string;
  onClose(): void;
  onPrint(request: { deviceName?: string; useSystemDialog?: boolean }): void;
  onExportPdf(): void;
  /** Called when the shop picks a different printer, so it can be remembered. */
  onPrinterChange?(deviceName: string): void;
  busy?: boolean;
}

/** A4 portrait at 96dpi — the size the template renders at. */
const SHEET_WIDTH = 794;
const SHEET_HEIGHT = 1123;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Zoom ladder, so the +/- buttons step the way a PDF viewer does. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/**
 * Print preview that behaves like a PDF viewer.
 *
 * Two details are load bearing:
 *
 * 1. The frame carries `allow-same-origin`. With a bare `sandbox=""` the document
 *    gets an opaque origin and Chromium then drops its inline `<style>` even
 *    though the page CSP allows `'unsafe-inline'` — the invoice rendered
 *    completely unstyled, which read as a blank preview. Scripts stay blocked.
 *
 * 2. The sheet sits inside a canvas that is at least as large as the viewport.
 *    Centring with flexbox alone clips the top and left edges once the content
 *    overflows, which is exactly what happens as soon as you zoom in.
 */
export function PrintPreview({
  invoice,
  copyLabel,
  onClose,
  onPrint,
  onExportPdf,
  onPrinterChange,
  busy,
}: PrintPreviewProps) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'fit-page' | 'fit-width' | 'free'>('fit-page');
  const [printers, setPrinters] = useState<PrinterChoice[] | null>(null);
  const [selected, setSelected] = useState('');
  const [panning, setPanning] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------------ data

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

  useEffect(() => {
    let cancelled = false;
    void api()
      .documents.listPrinters()
      .then((list) => {
        if (cancelled) return;
        setPrinters(list.printers);
        setSelected(list.selected);
      })
      .catch(() => {
        if (!cancelled) setPrinters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------------ zoom

  const fitScale = useCallback((target: 'fit-page' | 'fit-width') => {
    const stage = stageRef.current;
    if (!stage) return 1;
    const padding = 32;
    const byWidth = (stage.clientWidth - padding) / SHEET_WIDTH;
    if (target === 'fit-width') return clampZoom(byWidth);
    return clampZoom(Math.min(byWidth, (stage.clientHeight - padding) / SHEET_HEIGHT));
  }, []);

  const applyMode = useCallback(
    (target: 'fit-page' | 'fit-width') => {
      setMode(target);
      setZoom(fitScale(target));
    },
    [fitScale],
  );

  /** Zooms about a point in the viewport, so the page does not jump under the cursor. */
  const zoomAbout = useCallback((next: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    setMode('free');
    setZoom((current) => {
      const target = clampZoom(next);
      if (!stage || target === current) return target;

      const rect = stage.getBoundingClientRect();
      const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const anchorY = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const contentX = stage.scrollLeft + anchorX;
      const contentY = stage.scrollTop + anchorY;
      const ratio = target / current;

      // The scroll position can only be corrected once the canvas has resized.
      requestAnimationFrame(() => {
        stage.scrollLeft = contentX * ratio - anchorX;
        stage.scrollTop = contentY * ratio - anchorY;
      });
      return target;
    });
  }, []);

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
      const next = steps.find((step) => (direction > 0 ? step > zoom + 0.001 : step < zoom - 0.001));
      zoomAbout(next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM));
    },
    [zoom, zoomAbout],
  );

  // Re-fit while a fit mode is active and the window or content changes.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const refit = () => {
      if (mode === 'free') return;
      setZoom(fitScale(mode));
    };
    refit();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', refit);
      return () => window.removeEventListener('resize', refit);
    }
    const observer = new ResizeObserver(refit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [mode, fitScale, html]);

  // Ctrl/Cmd + wheel zooms; a plain wheel scrolls as usual.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAbout(zoom * factor, event.clientX, event.clientY);
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoom, zoomAbout]);

  // Keyboard: +, -, 0 to reset, F for fit page, W for fit width.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          stepZoom(1);
        } else if (event.key === '-') {
          event.preventDefault();
          stepZoom(-1);
        } else if (event.key === '0') {
          event.preventDefault();
          setMode('free');
          zoomAbout(1);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stepZoom, zoomAbout]);

  // ------------------------------------------------------------------- pan

  /**
   * Drag to move the page.
   *
   * The move and release listeners are attached here rather than from an effect
   * keyed on state: an effect only runs after the next render, so the first few
   * pixels of a quick drag would be dropped.
   */
  const startPan = useCallback((event: React.MouseEvent) => {
    const stage = stageRef.current;
    if (!stage || event.button !== 0) return;

    const canScroll =
      stage.scrollHeight > stage.clientHeight || stage.scrollWidth > stage.clientWidth;
    if (!canScroll) return;

    const from = {
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    setPanning(true);

    const onMove = (move: MouseEvent) => {
      stage.scrollLeft = from.left - (move.clientX - from.x);
      stage.scrollTop = from.top - (move.clientY - from.y);
    };
    const stop = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      setPanning(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
  }, []);

  // ----------------------------------------------------------------- print

  const noPrinters = printers !== null && printers.length === 0;
  const chosen = (printers ?? []).find((printer) => printer.name === selected);

  const pickPrinter = (name: string) => {
    setSelected(name);
    onPrinterChange?.(name);
  };

  const percent = Math.round(zoom * 100);

  return (
    <Modal title="Print Preview — A4" onClose={onClose} wide flush>
      <div className="viewer-toolbar">
        <div className="zoom-group" role="group" aria-label="Zoom">
          <button
            type="button"
            className="icon-btn"
            title="Zoom out (Ctrl and −)"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM + 0.001}
            onClick={() => stepZoom(-1)}
          >
            −
          </button>
          <button
            type="button"
            className="zoom-readout"
            title="Reset to 100% (Ctrl and 0)"
            onClick={() => {
              setMode('free');
              zoomAbout(1);
            }}
          >
            {percent}%
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Zoom in (Ctrl and +)"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM - 0.001}
            onClick={() => stepZoom(1)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={`btn btn-sm${mode === 'fit-page' ? ' btn-primary' : ''}`}
          onClick={() => applyMode('fit-page')}
        >
          Fit Page
        </button>
        <button
          type="button"
          className={`btn btn-sm${mode === 'fit-width' ? ' btn-primary' : ''}`}
          onClick={() => applyMode('fit-width')}
        >
          Fit Width
        </button>

        <span className="toolbar-divider" />

        <label className="toolbar-label" htmlFor="printer-choice">
          Printer
        </label>
        <select
          id="printer-choice"
          className="select toolbar-select"
          value={selected}
          disabled={printers === null || noPrinters || busy}
          onChange={(event) => pickPrinter(event.target.value)}
        >
          {printers === null ? <option value="">Looking for printers…</option> : null}
          {noPrinters ? <option value="">No printer found</option> : null}
          {(printers ?? []).map((printer) => (
            <option key={printer.name} value={printer.name}>
              {printer.displayName}
              {printer.isDefault ? ' — Windows default' : ''}
              {isVirtualPrinter(printer) ? ' (saves to a file)' : ''}
            </option>
          ))}
        </select>

        <div className="toolbar-end">
          <button type="button" className="btn btn-sm" onClick={onExportPdf} disabled={busy}>
            Save PDF
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || noPrinters}
            onClick={() => onPrint({ deviceName: selected || undefined })}
          >
            {busy ? <span className="spinner" /> : null}
            Print
          </button>
        </div>
      </div>

      {error ? (
        <div className="empty">
          <div className="empty-title">Preview failed</div>
          <div>{error}</div>
        </div>
      ) : (
        <div
          className={`preview-stage${panning ? ' panning' : ''}`}
          ref={stageRef}
          onMouseDown={startPan}
        >
          <div
            className="preview-canvas"
            style={{ width: SHEET_WIDTH * zoom + 32, height: SHEET_HEIGHT * zoom + 32 }}
          >
            <div
              className="preview-sheet"
              style={{ width: SHEET_WIDTH * zoom, height: SHEET_HEIGHT * zoom }}
            >
              <iframe
                className="preview-frame"
                title="Invoice preview"
                sandbox="allow-same-origin"
                srcDoc={html}
                scrolling="no"
                style={{
                  width: SHEET_WIDTH,
                  height: SHEET_HEIGHT,
                  transform: `scale(${zoom})`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="viewer-status">
        <span>A4 210 × 297 mm</span>
        <span className="muted">Ctrl and scroll to zoom · drag to move</span>
        {chosen && isVirtualPrinter(chosen) ? (
          <span className="viewer-warn">
            {chosen.displayName} saves to a file instead of printing on paper
          </span>
        ) : null}
        <button type="button" className="btn btn-sm btn-ghost push" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          title="Opens the Windows print dialog for tray and duplex options"
          onClick={() => onPrint({ useSystemDialog: true })}
        >
          System dialog…
        </button>
      </div>
    </Modal>
  );
}
