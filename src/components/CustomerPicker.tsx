import { useEffect, useRef, useState } from 'react';
import type { Customer } from '@shared/types';
import { api } from '../lib/api';
import { useClickOutside, useDebounced } from '../lib/hooks';

interface CustomerPickerProps {
  value: string;
  onChange(value: string): void;
  onPick(customer: Customer): void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * Type-ahead over name, mobile and GSTIN. Arrow keys move, Enter picks —
 * the counter never has to reach for the mouse to load a returning customer.
 */
export function CustomerPicker({ value, onChange, onPick, inputRef }: CustomerPickerProps) {
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const search = useDebounced(value, 180);
  const containerRef = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const localRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? localRef;

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }

    let cancelled = false;
    void api()
      .customers.list(term, 8)
      .then((found) => {
        if (cancelled) return;
        setResults(found);
        setHighlighted(0);
      });

    return () => {
      cancelled = true;
    };
  }, [search]);

  const choose = (customer: Customer) => {
    onPick(customer);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results[highlighted]) {
      event.preventDefault();
      choose(results[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showSuggestions = open && results.length > 0;

  return (
    <div className="customer-search" ref={containerRef}>
      <input
        ref={field}
        className="input strong"
        value={value}
        placeholder="Type name, mobile or GSTIN…"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showSuggestions ? (
        <div className="suggestions" role="listbox">
          {results.map((customer, index) => (
            <div
              key={customer.id}
              role="option"
              aria-selected={index === highlighted}
              className={`suggestion${index === highlighted ? ' active' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(customer);
              }}
            >
              <span className="suggestion-name">{customer.name}</span>
              <span className="suggestion-meta">
                {customer.mobile}
                {customer.gstin ? ` · ${customer.gstin}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
