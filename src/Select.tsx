import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  size?: 'sm' | 'md';
};

export default function Select({ value, options, onChange, disabled, className, title, size = 'md' }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find(o => o.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 2, left: r.left, width: r.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => !disabled && setOpen(o => !o)}
        className={'cs-trigger ' + (size === 'sm' ? 'cs-trigger-sm ' : '') + (open ? 'is-open ' : '') + (className ?? '')}
      >
        <span className="cs-trigger-label">{current?.label ?? ''}</span>
        <span className="cs-trigger-chev" aria-hidden="true">
          <svg width="8" height="6" viewBox="0 0 8 6"><path fill="currentColor" d="M0 0l4 6 4-6z"/></svg>
        </span>
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          className="cs-menu"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.width }}
          role="listbox"
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={'cs-option' + (o.value === value ? ' is-selected' : '')}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="cs-option-check">{o.value === value ? '✓' : ''}</span>
              <span className="cs-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
