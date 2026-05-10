import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  disabled?: boolean;
};

const PRESETS = [
  '#FFFFFF', '#000000', '#F5F5F5', '#9E9E9E', '#424242',
  '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
  '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
  '#FF5722', '#795548', '#607D8B', '#6c6cff', '#1f1f1f',
];

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
  else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
  else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
  else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
  else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export default function ColorPicker({ value, onChange, className, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'sv' | 'hue' | null>(null);

  const rgb = useMemo(() => hexToRgb(value), [value]);
  const hsv = useMemo(() => rgbToHsv(rgb.r, rgb.g, rgb.b), [rgb]);

  useEffect(() => { setHexInput(value.toUpperCase()); }, [value]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const W = 200, H = 220;
    let left = r.left;
    let top = r.bottom + 4;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (top + H > window.innerHeight - 8) top = r.top - H - 4;
    setMenuPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
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

  const setFromHsv = (h: number, s: number, v: number) => {
    const { r, g, b } = hsvToRgb(h, s, v);
    onChange(rgbToHex(r, g, b));
  };

  const handleSvPointer = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    setFromHsv(hsv.h, s, v);
  };
  const handleHuePointer = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    setFromHsv(ratio * 360, hsv.s === 0 ? 1 : hsv.s, hsv.v === 0 ? 1 : hsv.v);
  };

  useEffect(() => {
    if (!open) return;
    const move = (e: MouseEvent) => {
      if (draggingRef.current === 'sv') handleSvPointer(e.clientX, e.clientY);
      else if (draggingRef.current === 'hue') handleHuePointer(e.clientX);
    };
    const up = () => { draggingRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [open, hsv.h, hsv.s, hsv.v]);

  const commitHex = () => {
    let h = hexInput.trim();
    if (!h.startsWith('#')) h = '#' + h;
    if (/^#[0-9a-fA-F]{6}$/.test(h)) {
      onChange(h.toUpperCase());
    } else if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      const r = h[1], g = h[2], b = h[3];
      onChange(('#' + r + r + g + g + b + b).toUpperCase());
    } else {
      setHexInput(value.toUpperCase());
    }
  };

  const hueColor = useMemo(() => {
    const { r, g, b } = hsvToRgb(hsv.h, 1, 1);
    return rgbToHex(r, g, b);
  }, [hsv.h]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={'cp-trigger ' + (open ? 'is-open ' : '') + (className ?? '')}
      >
        <span className="cp-trigger-swatch" style={{ background: value }} />
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          className="cp-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          role="dialog"
        >
          <div
            ref={svRef}
            className="cp-sv"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
            onMouseDown={(e) => {
              draggingRef.current = 'sv';
              handleSvPointer(e.clientX, e.clientY);
            }}
          >
            <div
              className="cp-sv-thumb"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
            />
          </div>
          <div
            ref={hueRef}
            className="cp-hue"
            onMouseDown={(e) => {
              draggingRef.current = 'hue';
              handleHuePointer(e.clientX);
            }}
          >
            <div className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div className="cp-row">
            <span className="cp-preview" style={{ background: value }} />
            <input
              className="cp-hex"
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitHex(); (e.target as HTMLInputElement).blur(); }
              }}
              spellCheck={false}
              maxLength={7}
            />
          </div>
          <div className="cp-presets">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                className={'cp-preset' + (p.toUpperCase() === value.toUpperCase() ? ' is-selected' : '')}
                style={{ background: p }}
                onClick={() => onChange(p.toUpperCase())}
                title={p}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
