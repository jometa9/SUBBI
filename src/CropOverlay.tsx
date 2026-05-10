import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CropRect = { x: number; y: number; width: number; height: number };

interface Props {
  videoEl: HTMLVideoElement | null;
  // Crop in normalized coordinates (0..1) relative to the video's intrinsic frame.
  crop: CropRect;
  // Aspect ratio lock as width/height. null = free.
  aspectRatio: number | null;
  onChange: (next: CropRect) => void;
}

type DragMode =
  | { kind: 'move'; startX: number; startY: number; orig: CropRect }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; orig: CropRect };

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

// Compute the on-screen rect of the actual painted video pixels inside the <video> element
// (object-fit: contain leaves letterbox bars).
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
  return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
}

const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

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

export default function CropOverlay({ videoEl, crop, aspectRatio, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const dragRef = useRef<DragMode | null>(null);
  const [renderedRect, setRenderedRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Recompute rendered rect on resize / metadata load.
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

  // Re-apply aspect ratio whenever it changes.
  useEffect(() => {
    if (aspectRatio == null || !videoEl?.videoWidth) return;
    const next = applyAspectRatio(crop, aspectRatio, videoEl.videoWidth, videoEl.videoHeight);
    if (next.x !== crop.x || next.y !== crop.y || next.width !== crop.width || next.height !== crop.height) {
      onChange(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio]);

  function applyAspectRatio(c: CropRect, ar: number, vw: number, vh: number): CropRect {
    // ar is width/height in pixel space. Our normalized coords have width* vw / height*vh = ar.
    // So height_norm = (width_norm * vw) / (vh * ar)
    let w = c.width;
    let h = (w * vw) / (vh * ar);
    if (h > 1) {
      h = 1;
      w = (h * vh * ar) / vw;
    }
    // Center around current center.
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    let x = clamp(cx - w / 2, 0, 1 - w);
    let y = clamp(cy - h / 2, 0, 1 - h);
    return { x, y, width: w, height: h };
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
      const x = clamp(drag.orig.x + dxNorm, 0, 1 - w);
      const y = clamp(drag.orig.y + dyNorm, 0, 1 - h);
      onChange({ x, y, width: w, height: h });
      return;
    }

    // resize
    let { x, y, width, height } = drag.orig;
    const handle = drag.handle;
    const minSize = 0.05;
    if (handle.includes('e')) width = clamp(drag.orig.width + dxNorm, minSize, 1 - drag.orig.x);
    if (handle.includes('w')) {
      const nx = clamp(drag.orig.x + dxNorm, 0, drag.orig.x + drag.orig.width - minSize);
      width = drag.orig.x + drag.orig.width - nx;
      x = nx;
    }
    if (handle.includes('s')) height = clamp(drag.orig.height + dyNorm, minSize, 1 - drag.orig.y);
    if (handle.includes('n')) {
      const ny = clamp(drag.orig.y + dyNorm, 0, drag.orig.y + drag.orig.height - minSize);
      height = drag.orig.y + drag.orig.height - ny;
      y = ny;
    }

    if (aspectRatio != null) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      // Recompute height from width to enforce aspect (width tends to be the active dimension).
      // For corner handles this preserves the dragged width; for n/s handles reverse.
      if (handle === 'n' || handle === 's') {
        const newW = (height * vh * aspectRatio) / vw;
        if (handle === 'n') x = clamp(drag.orig.x + drag.orig.width / 2 - newW / 2, 0, 1 - newW);
        else x = clamp(drag.orig.x + drag.orig.width / 2 - newW / 2, 0, 1 - newW);
        width = Math.min(newW, 1);
      } else {
        const newH = (width * vw) / (vh * aspectRatio);
        if (handle.includes('n')) y = clamp(drag.orig.y + drag.orig.height - newH, 0, 1 - newH);
        height = Math.min(newH, 1);
      }
      // Clamp to bounds (shrink if overflow)
      if (x + width > 1) { width = 1 - x; height = (width * vw) / (vh * aspectRatio); }
      if (y + height > 1) { height = 1 - y; width = (height * vh * aspectRatio) / vw; }
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
        pointerEvents: 'auto',
        zIndex: 5,
      }}
    >
      {/* Dim outside */}
      <svg
        width="100%" height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <mask id="cropMask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect x={boxLeft} y={boxTop} width={boxW} height={boxH} fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#cropMask)" />
      </svg>

      {/* Crop box */}
      <div
        onPointerDown={(e) => startDrag(e, { kind: 'move', startX: e.clientX, startY: e.clientY, orig: crop })}
        style={{
          position: 'absolute',
          left: boxLeft,
          top: boxTop,
          width: boxW,
          height: boxH,
          border: '1.5px solid #ffffff',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
          cursor: 'move',
          boxSizing: 'border-box',
        }}
      >
        {/* Rule-of-thirds grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(to right, transparent 33.33%, rgba(255,255,255,0.4) 33.33%, rgba(255,255,255,0.4) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,0.4) 66.66%, rgba(255,255,255,0.4) calc(66.66% + 1px), transparent calc(66.66% + 1px)),' +
            'linear-gradient(to bottom, transparent 33.33%, rgba(255,255,255,0.4) 33.33%, rgba(255,255,255,0.4) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,0.4) 66.66%, rgba(255,255,255,0.4) calc(66.66% + 1px), transparent calc(66.66% + 1px))',
          pointerEvents: 'none',
        }} />
        {/* Handles */}
        {HANDLES.map(h => (
          <div
            key={h}
            onPointerDown={(e) => startDrag(e, { kind: 'resize', handle: h, startX: e.clientX, startY: e.clientY, orig: crop })}
            style={{
              position: 'absolute',
              width: 10, height: 10,
              background: '#ffffff',
              border: '1px solid #1a1a1a',
              borderRadius: 2,
              ...HANDLE_STYLE[h],
            }}
          />
        ))}
      </div>
    </div>
  );
}
