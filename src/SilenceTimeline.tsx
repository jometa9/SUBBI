import React, { useEffect, useImperativeHandle, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';

export type SilenceRegion = {
  id: string;
  start: number;
  end: number;
  enabled: boolean; // true = will be cut
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
  splitMarkers?: number[];
  selectedMarker?: number | null;
  onSelectMarker?: (time: number | null) => void;
  height?: number;
}

const SilenceTimeline = React.forwardRef<SilenceTimelineHandle, Props>(function SilenceTimeline(
  {
    videoEl, peaks, duration, regions, currentTime,
    onToggleRegion, onUpdateRegion,
    splitMarkers = [], selectedMarker = null, onSelectMarker,
    height = 84,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const regionMapRef = useRef<Map<string, Region>>(new Map());
  const seekingFromVideoRef = useRef(false);

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

  // Init wavesurfer once we have a container, video element, peaks and duration.
  useEffect(() => {
    if (!containerRef.current || !videoEl || !peaks || peaks.length === 0 || duration <= 0) return;

    const regionsPlugin = RegionsPlugin.create();
    regionsPluginRef.current = regionsPlugin;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: '#5b6470',
      progressColor: '#9aa3ad',
      cursorColor: '#ffd166',
      cursorWidth: 3,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
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

    regionsPlugin.on('region-updated', (region) => {
      onUpdateRegion?.(region.id, region.start, region.end);
    });

    ws.on('interaction', (newTime: number) => {
      if (videoEl && !seekingFromVideoRef.current) {
        videoEl.currentTime = newTime;
      }
    });

    return () => {
      regionMapRef.current.clear();
      ws.destroy();
      wsRef.current = null;
      regionsPluginRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoEl, peaks, duration]);

  // Sync regions list with the plugin.
  useEffect(() => {
    const plugin = regionsPluginRef.current;
    if (!plugin) return;

    const incomingIds = new Set(regions.map(r => r.id));
    for (const [id, reg] of regionMapRef.current) {
      if (!incomingIds.has(id)) {
        try { reg.remove(); } catch {}
        regionMapRef.current.delete(id);
      }
    }

    for (const r of regions) {
      const existing = regionMapRef.current.get(r.id);
      const color = r.enabled
        ? 'rgba(239, 68, 68, 0.35)'
        : 'rgba(120, 120, 120, 0.18)';
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
          drag: false,
          resize: true,
        });
        regionMapRef.current.set(r.id, reg);
      }
    }
  }, [regions]);

  // Note: with `media: videoEl`, wavesurfer subscribes to the video's `timeupdate`
  // and moves the cursor automatically. We don't need to seek manually here.

  const showMarkers = duration > 0 && splitMarkers.length > 0;

  return (
    <div
      className="st-wrap w-full relative"
      style={{ minHeight: height }}
      onClick={(e) => {
        // Click on empty area (not a marker) clears selection.
        if ((e.target as HTMLElement).dataset.splitMarker == null) {
          onSelectMarker?.(null);
        }
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
