import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CropRect = { x: number; y: number; width: number; height: number };

interface Props {
  videoEl: HTMLVideoElement | null;
  crop: CropRect;
  aspectRatio: number | null;
  onChange: (next: CropRect) => void;
  onApply?: () => void;
  onUserResize?: () => void;
  applyLabel?: string;
  fitLabel?: string;
  fillLabel?: string;
  onFit?: () => void;
  onFill?: () => void;
  bgColor?: 'black' | 'white';
}

type DragMode =
  | { kind: 'move'; startX: number; startY: number; orig: CropRect }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; orig: CropRect };

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function getRenderedVideoRect(v: HTMLVideoElement): { left: number; top: number; width: number; height: number } | null {
  const cw = v.clientWidth;
  const ch = v.clientHeight;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!cw || !ch || !vw || !vh) return null;
  const containerAspect = cw / ch;
  const videoAspect = vw / vh;
  let w: number, h: number;
  if (videoAspect > containerAspect) {
    w = cw;
    h = cw / videoAspect;
  } else {
    h = ch;
    w = ch * videoAspect;
  }
  const ox = v.offsetLeft;
  const oy = v.offsetTop;
  return { left: ox + (cw - w) / 2, top: oy + (ch - h) / 2, width: w, height: h };
}

const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function overlayBtnStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    background: kind === 'primary' ? 'var(--c-accent)' : 'var(--c-surface-strong, rgba(20,20,20,0.85))',
    color: kind === 'primary' ? 'var(--c-text-strong)' : 'var(--c-text-strong, #fff)',
    border: '1px solid ' + (kind === 'primary' ? 'var(--c-accent-border)' : 'var(--c-border, rgba(255,255,255,0.25))'),
    borderRadius: 4,
    cursor: 'pointer',
    boxShadow: '0 1px 3px var(--c-shadow-mid)',
  };
}

const HANDLE_STYLE: Record<Handle, React.CSSProperties> = {
  n:  { top: -5, left: '50%', transform: 'translate(-50%, 0)', cursor: 'ns-resize' },
  s:  { bottom: -5, left: '50%', transform: 'translate(-50%, 0)', cursor: 'ns-resize' },
  e:  { right: -5, top: '50%', transform: 'translate(0, -50%)', cursor: 'ew-resize' },
  w:  { left: -5, top: '50%', transform: 'translate(0, -50%)', cursor: 'ew-resize' },
  ne: { top: -5, right: -5, cursor: 'nesw-resize' },
  nw: { top: -5, left: -5, cursor: 'nwse-resize' },
  se: { bottom: -5, right: -5, cursor: 'nwse-resize' },
  sw: { bottom: -5, left: -5, cursor: 'nesw-resize' },
};

export default function CropOverlay({ videoEl, crop, aspectRatio, onChange, onApply, onUserResize, applyLabel = 'Apply', fitLabel = 'Fit', fillLabel = 'Fill', onFit, onFill, bgColor = 'black' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const dragRef = useRef<DragMode | null>(null);
  const [renderedRect, setRenderedRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!videoEl) return;
    const update = () => setRenderedRect(getRenderedVideoRect(videoEl));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(videoEl);
    videoEl.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      videoEl.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', update);
    };
  }, [videoEl]);

  useEffect(() => {
    if (aspectRatio == null || !videoEl?.videoWidth) return;
    const next = applyAspectRatio(crop, aspectRatio, videoEl.videoWidth, videoEl.videoHeight);
    if (next.x !== crop.x || next.y !== crop.y || next.width !== crop.width || next.height !== crop.height) {
      onChange(next);
    }
  }, [aspectRatio]);

  function applyAspectRatio(c: CropRect, ar: number, vw: number, vh: number): CropRect {
    const w = c.width;
    const h = (w * vw) / (vh * ar);
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  }

  function startDrag(e: React.PointerEvent, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = mode;
    force(n => n + 1);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !renderedRect || !videoEl?.videoWidth) return;
    const dxNorm = (e.clientX - drag.startX) / renderedRect.width;
    const dyNorm = (e.clientY - drag.startY) / renderedRect.height;

    if (drag.kind === 'move') {
      const w = drag.orig.width;
      const h = drag.orig.height;
      const x = drag.orig.x + dxNorm;
      const y = drag.orig.y + dyNorm;
      onChange({ x, y, width: w, height: h });
      return;
    }

    let { x, y, width, height } = drag.orig;
    const handle = drag.handle;
    const minSize = 0.05;
    if (handle.includes('e')) width = Math.max(minSize, drag.orig.width + dxNorm);
    if (handle.includes('w')) {
      const nx = Math.min(drag.orig.x + dxNorm, drag.orig.x + drag.orig.width - minSize);
      width = drag.orig.x + drag.orig.width - nx;
      x = nx;
    }
    if (handle.includes('s')) height = Math.max(minSize, drag.orig.height + dyNorm);
    if (handle.includes('n')) {
      const ny = Math.min(drag.orig.y + dyNorm, drag.orig.y + drag.orig.height - minSize);
      height = drag.orig.y + drag.orig.height - ny;
      y = ny;
    }

    if (aspectRatio != null) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (handle === 'n' || handle === 's') {
        const newW = (height * vh * aspectRatio) / vw;
        x = drag.orig.x + drag.orig.width / 2 - newW / 2;
        width = newW;
      } else {
        const newH = (width * vw) / (vh * aspectRatio);
        if (handle.includes('n')) y = drag.orig.y + drag.orig.height - newH;
        height = newH;
      }
    }

    onChange({ x, y, width, height });
  }

  function endDrag(e: React.PointerEvent) {
    if (dragRef.current) {
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
      dragRef.current = null;
      force(n => n + 1);
    }
  }

  if (!renderedRect) return null;

  const boxLeft = renderedRect.left + crop.x * renderedRect.width;
  const boxTop = renderedRect.top + crop.y * renderedRect.height;
  const boxW = crop.width * renderedRect.width;
  const boxH = crop.height * renderedRect.height;

  return (
    <div
      ref={overlayRef}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <svg
        width="100%" height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      >
        <defs>
          <mask id="cropMask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect x={boxLeft} y={boxTop} width={boxW} height={boxH} fill="black" />
          </mask>
          <clipPath id="cropClip">
            <rect x={boxLeft} y={boxTop} width={boxW} height={boxH} />
          </clipPath>
          <mask id="videoMask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect x={renderedRect.left} y={renderedRect.top} width={renderedRect.width} height={renderedRect.height} fill="black" />
          </mask>
        </defs>
        <g clipPath="url(#cropClip)">
          <rect
            x={boxLeft}
            y={boxTop}
            width={boxW}
            height={boxH}
            fill={bgColor === 'white' ? '#ffffff' : '#000000'}
            mask="url(#videoMask)"
          />
        </g>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.30)" mask="url(#cropMask)" />
      </svg>

      <div
        onPointerDown={(e) => startDrag(e, { kind: 'move', startX: e.clientX, startY: e.clientY, orig: crop })}
        style={{
          position: 'absolute',
          left: boxLeft,
          top: boxTop,
          width: boxW,
          height: boxH,
          border: '1.5px solid var(--c-accent)',
          boxShadow: '0 0 0 1px var(--c-shadow-strong)',
          cursor: 'move',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(to right, transparent 33.33%, rgba(255,255,255,0.4) 33.33%, rgba(255,255,255,0.4) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,0.4) 66.66%, rgba(255,255,255,0.4) calc(66.66% + 1px), transparent calc(66.66% + 1px)),' +
            'linear-gradient(to bottom, transparent 33.33%, rgba(255,255,255,0.4) 33.33%, rgba(255,255,255,0.4) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,0.4) 66.66%, rgba(255,255,255,0.4) calc(66.66% + 1px), transparent calc(66.66% + 1px))',
          pointerEvents: 'none',
        }} />
        <div
          style={{
            position: 'absolute',
            top: -32,
            right: 0,
            display: 'flex',
            gap: 6,
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onFit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFit(); }}
              style={overlayBtnStyle('secondary')}
            >{fitLabel}</button>
          )}
          {onFill && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFill(); }}
              style={overlayBtnStyle('secondary')}
            >{fillLabel}</button>
          )}
          {onApply && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApply(); }}
              style={overlayBtnStyle('primary')}
            >{applyLabel}</button>
          )}
        </div>
        {HANDLES.map(h => (
          <div
            key={h}
            onPointerDown={(e) => { if (aspectRatio == null) onUserResize?.(); startDrag(e, { kind: 'resize', handle: h, startX: e.clientX, startY: e.clientY, orig: crop }); }}
            style={{
              position: 'absolute',
              width: 10, height: 10,
              background: 'var(--c-accent)',
              border: '1px solid var(--c-accent-border)',
              borderRadius: 2,
              ...HANDLE_STYLE[h],
            }}
          />
        ))}
      </div>
    </div>
  );
}
