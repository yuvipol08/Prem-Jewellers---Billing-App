import { useCallback } from 'react';
import { computeItem, formatCurrency } from '@shared/calc';
import { COMMON_HSN } from '@shared/defaults';
import type { InvoiceItem, MakingChargeMode } from '@shared/types';

interface ItemsTableProps {
  items: InvoiceItem[];
  onChange(index: number, patch: Partial<InvoiceItem>): void;
  onRemove(index: number): void;
  onAddRow(): void;
}

/** Blank instead of a literal 0, so an empty rate cell does not read as "free". */
function numberValue(value: number): string {
  return value === 0 ? '' : String(value);
}

const MAKING_MODES: { value: MakingChargeMode; label: string; title: string }[] = [
  { value: 'flat', label: '₹', title: 'Flat amount' },
  { value: 'per_gram', label: '/g', title: 'Per gram' },
  { value: 'percent', label: '%', title: 'Percent of metal value' },
];

export function ItemsTable({ items, onChange, onRemove, onAddRow }: ItemsTableProps) {
  /**
   * Enter moves down the same column and adds a row off the last line, so a
   * whole bill can be typed without touching the mouse. Ctrl+Enter is left free
   * for "save and print".
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, rowIndex: number, column: string) => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) return;
      event.preventDefault();

      const isLastRow = rowIndex === items.length - 1;
      if (isLastRow) onAddRow();

      // The new row is mounted by the time the frame is painted.
      requestAnimationFrame(() => {
        const next = document.querySelector<HTMLElement>(
          `[data-cell="${column}-${rowIndex + 1}"]`,
        );
        next?.focus();
        if (next instanceof HTMLInputElement) next.select();
      });
    },
    [items.length, onAddRow],
  );

  return (
    <>
      <table className="items-table">
        <thead>
          <tr>
            <th className="col-sr">#</th>
            <th className="col-hsn left">HSN</th>
            <th className="left">Particulars</th>
            <th className="col-wt">Gross Wt (g)</th>
            <th className="col-wt">Net Wt (g)</th>
            <th className="col-rate">Rate (₹/g)</th>
            <th className="col-mc">Making</th>
            <th className="col-amt">Amount (₹)</th>
            <th className="col-del" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const computed = computeItem(item);
            return (
              <tr key={index}>
                <td className="col-sr">{index + 1}</td>
                <td>
                  <input
                    className="cell-input"
                    list="hsn-options"
                    value={item.hsnCode}
                    data-cell={`hsn-${index}`}
                    onChange={(event) => onChange(index, { hsnCode: event.target.value })}
                    onKeyDown={(event) => onKeyDown(event, index, 'hsn')}
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    value={item.particulars}
                    placeholder="e.g. Gold Necklace 22K"
                    data-cell={`particulars-${index}`}
                    onChange={(event) => onChange(index, { particulars: event.target.value })}
                    onKeyDown={(event) => onKeyDown(event, index, 'particulars')}
                  />
                </td>
                <td>
                  <input
                    className="cell-input num"
                    type="number"
                    step="0.001"
                    min="0"
                    value={numberValue(item.grossWeight)}
                    data-cell={`gross-${index}`}
                    onChange={(event) =>
                      onChange(index, { grossWeight: Number(event.target.value) || 0 })
                    }
                    onKeyDown={(event) => onKeyDown(event, index, 'gross')}
                  />
                </td>
                <td>
                  <input
                    className="cell-input num"
                    type="number"
                    step="0.001"
                    min="0"
                    value={numberValue(item.netWeight)}
                    data-cell={`net-${index}`}
                    onChange={(event) =>
                      onChange(index, { netWeight: Number(event.target.value) || 0 })
                    }
                    onKeyDown={(event) => onKeyDown(event, index, 'net')}
                  />
                </td>
                <td>
                  <input
                    className="cell-input num"
                    type="number"
                    step="0.01"
                    min="0"
                    value={numberValue(item.rate)}
                    data-cell={`rate-${index}`}
                    onChange={(event) => onChange(index, { rate: Number(event.target.value) || 0 })}
                    onKeyDown={(event) => onKeyDown(event, index, 'rate')}
                  />
                </td>
                <td>
                  <div className="making-cell">
                    <input
                      className="cell-input num"
                      type="number"
                      step="0.01"
                      min="0"
                      value={numberValue(item.makingChargeValue)}
                      data-cell={`making-${index}`}
                      onChange={(event) =>
                        onChange(index, { makingChargeValue: Number(event.target.value) || 0 })
                      }
                      onKeyDown={(event) => onKeyDown(event, index, 'making')}
                    />
                    <select
                      className="cell-select"
                      value={item.makingChargeMode}
                      aria-label="Making charge type"
                      onChange={(event) =>
                        onChange(index, {
                          makingChargeMode: event.target.value as MakingChargeMode,
                        })
                      }
                    >
                      {MAKING_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value} title={mode.title}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="amount-cell">
                  {computed.amount ? formatCurrency(computed.amount, false) : '—'}
                </td>
                <td>
                  <button
                    type="button"
                    className="row-delete"
                    title="Remove line"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <datalist id="hsn-options">
        {COMMON_HSN.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.label}
          </option>
        ))}
      </datalist>
    </>
  );
}
