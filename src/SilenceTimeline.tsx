import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';

export type SilenceRegion = {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
  manual?: boolean;
};

export interface SilenceTimelineHandle {
  seek(timeSec: number): void;
  playPause(): void;
}

interface Props {
  videoEl: HTMLVideoElement | null;
  peaks: number[] | null;
  duration: number;
  regions: SilenceRegion[];
  currentTime: number;
  onToggleRegion: (id: string) => void;
  onUpdateRegion?: (id: string, start: number, end: number) => void;
  onRemoveRegion?: (id: string) => void;
  splitMarkers?: number[];
  selectedMarker?: number | null;
  onSelectMarker?: (time: number | null) => void;
  height?: number;
  theme?: 'light' | 'dark';
}

function waveColors(theme: 'light' | 'dark' | undefined) {
  if (theme === 'light') {
    return { waveColor: '#9aa3ad', progressColor: '#5b6470', cursorColor: '#d97706' };
  }
  return { waveColor: '#5b6470', progressColor: '#9aa3ad', cursorColor: '#ffd166' };
}

const SilenceTimeline = React.forwardRef<SilenceTimelineHandle, Props>(function SilenceTimeline(
  {
    videoEl, peaks, duration, regions, currentTime,
    onToggleRegion, onUpdateRegion, onRemoveRegion,
    splitMarkers = [], selectedMarker = null, onSelectMarker,
    height = 84, theme,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const regionMapRef = useRef<Map<string, Region>>(new Map());
  const regionsDataRef = useRef<Map<string, SilenceRegion>>(new Map());
  const seekingFromVideoRef = useRef(false);
  const [pluginReadyTick, setPluginReadyTick] = useState(0);

  useImperativeHandle(ref, () => ({
    seek(timeSec) {
      const ws = wsRef.current;
      if (!ws) return;
      const dur = ws.getDuration();
      if (dur > 0) ws.seekTo(Math.min(1, Math.max(0, timeSec / dur)));
    },
    playPause() {
      wsRef.current?.playPause();
    },
  }));

  useEffect(() => {
    if (!containerRef.current || !videoEl || !peaks || peaks.length === 0 || duration <= 0) return;

    const regionsPlugin = RegionsPlugin.create();
    regionsPluginRef.current = regionsPlugin;

    const colors = waveColors(theme);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: colors.waveColor,
      progressColor: colors.progressColor,
      cursorColor: colors.cursorColor,
      cursorWidth: 3,
      barWidth: 2,
      barGap: 2,
      barRadius: 1,
      normalize: true,
      interact: true,
      media: videoEl,
      peaks: [peaks],
      duration,
      plugins: [regionsPlugin],
    });
    wsRef.current = ws;

    regionsPlugin.on('region-clicked', (region, e) => {
      e.stopPropagation();
      onToggleRegion(region.id);
    });

    regionsPlugin.on('region-double-clicked', (region, e) => {
      const data = regionsDataRef.current.get(region.id);
      if (data?.manual) {
        e.stopPropagation();
        onRemoveRegion?.(region.id);
      }
    });

    regionsPlugin.on('region-updated', (region) => {
      onUpdateRegion?.(region.id, region.start, region.end);
    });

    ws.on('interaction', (newTime: number) => {
      if (videoEl && !seekingFromVideoRef.current) {
        videoEl.currentTime = newTime;
      }
    });

    setPluginReadyTick(t => t + 1);

    return () => {
      regionMapRef.current.clear();
      ws.destroy();
      wsRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [videoEl, peaks, duration]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const colors = waveColors(theme);
    try {
      ws.setOptions({
        waveColor: colors.waveColor,
        progressColor: colors.progressColor,
        cursorColor: colors.cursorColor,
      });
    } catch {}
  }, [theme]);

  useEffect(() => {
    const plugin = regionsPluginRef.current;
    if (!plugin) return;

    const incomingIds = new Set(regions.map(r => r.id));
    for (const [id, reg] of regionMapRef.current) {
      if (!incomingIds.has(id)) {
        try { reg.remove(); } catch {}
        regionMapRef.current.delete(id);
        regionsDataRef.current.delete(id);
      }
    }

    for (const r of regions) {
      regionsDataRef.current.set(r.id, r);
      const existing = regionMapRef.current.get(r.id);
      const color = !r.enabled
        ? 'rgba(120, 120, 120, 0.18)'
        : r.manual
          ? 'rgba(168, 85, 247, 0.38)'
          : 'rgba(239, 68, 68, 0.35)';
      if (existing) {
        if (existing.start !== r.start || existing.end !== r.end) {
          existing.setOptions({ start: r.start, end: r.end, color });
        } else {
          existing.setOptions({ color });
        }
      } else {
        const reg = plugin.addRegion({
          id: r.id,
          start: r.start,
          end: r.end,
          color,
          drag: !!r.manual,
          resize: true,
        });
        regionMapRef.current.set(r.id, reg);
      }
    }
  }, [regions, pluginReadyTick]);

  const showMarkers = duration > 0 && splitMarkers.length > 0;

  return (
    <div
      className="st-wrap w-full relative"
      style={{ minHeight: height }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.dataset.splitMarker == null) onSelectMarker?.(null);
      }}
    >
      <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
      {showMarkers && splitMarkers.map((t, i) => {
        const left = (t / duration) * 100;
        const isSel = selectedMarker != null && Math.abs(selectedMarker - t) < 1e-6;
        return (
          <button
            key={`${i}-${t.toFixed(3)}`}
            type="button"
            data-split-marker="1"
            className={'st-marker' + (isSel ? ' is-selected' : '')}
            style={{ left: `${left}%` }}
            title={`${t.toFixed(2)}s`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectMarker?.(isSel ? null : t);
            }}
          />
        );
      })}
    </div>
  );
});

export default SilenceTimeline;
