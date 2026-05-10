import React, { useEffect, useMemo, useRef, useState } from 'react';
import SilenceTimeline, { type SilenceRegion, type SilenceTimelineHandle } from './SilenceTimeline';
import CropOverlay, { type CropRect } from './CropOverlay';

type Cue = { start: number; end: number; text: string };

type SubtitleStyle = {
  fontName: string;
  fontSize: number;
  color: string;
  outline: string;
  marginVPct: number;
  marginHPct: number;
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
};

type ProcessState =
  | { phase: 'idle' }
  | { phase: 'transcribing'; pct: number; log: string }
  | { phase: 'detecting' }
  | { phase: 'exporting'; pct: number; log: string }
  | { phase: 'exported'; outPath: string }
  | { phase: 'error'; message: string };

const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Arial',
  fontSize: 28,
  color: '#FFFFFF',
  outline: '#000000',
  marginVPct: 8,
  marginHPct: 0,
  textCase: 'asis',
  maxWords: 4,
};

const FONT_OPTIONS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];

type AspectPreset = { id: string; label: string; ratio: number | null };
const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
];

type UiLang = 'en' | 'es';

const TRANSLATIONS: Record<UiLang, Record<string, string>> = {
  en: {
    openVideo: 'Open video',
    dropHere: 'Drop a video here',
    dropNow: 'Release to drop',
    orClick: 'or click to choose',
    sampleSubtitle: 'Sample subtitle',
    transcription: 'Transcription',
    language: 'Language',
    langSpanish: 'Spanish', langEnglish: 'English', langPortuguese: 'Portuguese', langAuto: 'Auto',
    model: 'Model',
    modelTiny: 'Tiny (fast)', modelMedium: 'Medium', modelLarge: 'Large (accurate)',
    transcribe: 'Transcribe', transcribing: 'Transcribing',
    subtitleStyle: 'Subtitle style',
    font: 'Font', size: 'Size', vertical: 'Vertical', horizontal: 'Horizontal',
    color: 'Color', outline: 'Outline',
    textCase: 'Case', caseAsIs: 'As is', caseUpper: 'UPPERCASE', caseLower: 'lowercase',
    maxPerLine: 'Max words',
    couldNotReadPath: 'Could not read file path. Try "Open video".',
    silenceSection: 'Silence removal',
    detectSilences: 'Detect silences', detecting: 'Detecting',
    threshold: 'Threshold', minDuration: 'Min duration',
    autoMean: 'Auto (mean − 12 dB)',
    silencesFound: 'silences found',
    clickRegionToToggle: 'Click red regions to keep them. Drag edges to adjust.',
    noSilences: 'No silences detected at this threshold.',
    cropSection: 'Crop',
    aspectRatio: 'Aspect ratio',
    enableCrop: 'Enable crop',
    resetCrop: 'Reset',
    audioSection: 'Audio',
    audioGain: 'Volume gain',
    audioGainHint: 'Boost or attenuate the audio track on export.',
    exportSection: 'Export',
    exportNow: 'Export video',
    exporting: 'Exporting',
    exportDone: 'Export complete',
    nothingToExport: 'No edits to export — nothing to do.',
    showInFolder: 'Show in folder',
    untitledProject: 'Untitled Project',
    sectionSource: 'Source',
    sectionCrop: 'Crop',
    sectionSilence: 'Silence',
    sectionTranscription: 'Transcription',
    sectionSubtitleStyle: 'Subtitle style',
    cues: 'cues',
    generatingWaveform: 'Generating waveform…',
    pillSilence: 'SILENCE',
    pillSubs: 'SUBS',
    pillCrop: 'CROP',
    aspectFree: 'Free',
    pause: 'Pause',
    play: 'Play',
    mute: 'Mute',
    unmute: 'Unmute',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Reset',
  },
  es: {
    openVideo: 'Abrir video',
    dropHere: 'Soltá un video aquí',
    dropNow: 'Soltalo ahora',
    orClick: 'o hacé click para elegir',
    sampleSubtitle: 'Subtítulo de ejemplo',
    transcription: 'Transcripción',
    language: 'Idioma',
    langSpanish: 'Español', langEnglish: 'Inglés', langPortuguese: 'Portugués', langAuto: 'Auto',
    model: 'Modelo',
    modelTiny: 'Tiny (rápido)', modelMedium: 'Medium', modelLarge: 'Large (preciso)',
    transcribe: 'Transcribir', transcribing: 'Transcribiendo',
    subtitleStyle: 'Estilo del subtítulo',
    font: 'Fuente', size: 'Tamaño', vertical: 'Vertical', horizontal: 'Horizontal',
    color: 'Color', outline: 'Contorno',
    textCase: 'Mayús/minús', caseAsIs: 'Tal cual', caseUpper: 'MAYÚSCULAS', caseLower: 'minúsculas',
    maxPerLine: 'Máx palabras',
    couldNotReadPath: 'No se pudo leer la ruta del archivo. Probá con "Abrir video".',
    silenceSection: 'Quitar silencios',
    detectSilences: 'Detectar silencios', detecting: 'Detectando',
    threshold: 'Umbral', minDuration: 'Duración mín.',
    autoMean: 'Auto (promedio − 12 dB)',
    silencesFound: 'silencios encontrados',
    clickRegionToToggle: 'Click en las regiones rojas para conservarlas. Arrastrá los bordes para ajustar.',
    noSilences: 'No se detectaron silencios con este umbral.',
    cropSection: 'Recortar',
    aspectRatio: 'Relación de aspecto',
    enableCrop: 'Activar recorte',
    resetCrop: 'Restablecer',
    audioSection: 'Audio',
    audioGain: 'Ganancia de volumen',
    audioGainHint: 'Subí o bajá el audio del video al exportar.',
    exportSection: 'Exportar',
    exportNow: 'Exportar video',
    exporting: 'Exportando',
    exportDone: 'Exportación completa',
    nothingToExport: 'No hay ediciones para exportar.',
    showInFolder: 'Mostrar en carpeta',
    untitledProject: 'Proyecto sin título',
    sectionSource: 'Origen',
    sectionCrop: 'Recortar',
    sectionSilence: 'Silencios',
    sectionTranscription: 'Transcripción',
    sectionSubtitleStyle: 'Estilo del subtítulo',
    cues: 'subtítulos',
    generatingWaveform: 'Generando forma de onda…',
    pillSilence: 'SILENCIO',
    pillSubs: 'SUBS',
    pillCrop: 'RECORTE',
    aspectFree: 'Libre',
    pause: 'Pausar',
    play: 'Reproducir',
    mute: 'Silenciar',
    unmute: 'Activar audio',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Restablecer',
  },
};

function detectUiLang(): UiLang {
  const nav = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || '';
  const langs = (typeof navigator !== 'undefined' && (navigator as any).languages) || [nav];
  for (const l of langs) if (typeof l === 'string' && l.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

function parseSrt(srt: string): Cue[] {
  const out: Cue[] = [];
  const blocks = srt.replace(/\r/g, '').split(/\n\n+/);
  const tsRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g;
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const tline = lines.find(l => l.includes('-->'));
    if (!tline) continue;
    const matches = [...tline.matchAll(tsRe)];
    if (matches.length < 2) continue;
    const toMs = (m: RegExpMatchArray) =>
      (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    out.push({
      start: toMs(matches[0]),
      end: toMs(matches[1]),
      text: lines.slice(lines.indexOf(tline) + 1).join('\n').trim(),
    });
  }
  return out;
}

function resegmentByWords(cues: Cue[], maxWords: number): Cue[] {
  if (!maxWords || maxWords <= 0) return cues;
  const out: Cue[] = [];
  for (const c of cues) {
    const words = c.text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) { out.push(c); continue; }
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
    const totalChars = chunks.reduce((s, x) => s + x.length, 0) || 1;
    const totalDur = c.end - c.start;
    let t = c.start;
    for (let i = 0; i < chunks.length; i++) {
      const dur = i === chunks.length - 1 ? c.end - t : totalDur * (chunks[i].length / totalChars);
      out.push({ start: t, end: t + dur, text: chunks[i] });
      t += dur;
    }
  }
  return out;
}

function applyCase(s: string, c: SubtitleStyle['textCase']) {
  if (c === 'upper') return s.toLocaleUpperCase();
  if (c === 'lower') return s.toLocaleLowerCase();
  return s;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}.${pad(ms)}`
    : `${pad(m)}:${pad(s)}.${pad(ms)}`;
}

const STORAGE_KEY = 'subbi:settings:v2';

type PersistedSettings = {
  uiLang?: UiLang;
  language?: string;
  model?: 'tiny' | 'medium' | 'large';
  style?: SubtitleStyle;
};

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function saveSettings(s: PersistedSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };

export default function App() {
  const initial = useMemo(loadSettings, []);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [language, setLanguage] = useState(initial.language ?? 'es');
  const [model, setModel] = useState<'tiny' | 'medium' | 'large'>(initial.model ?? 'medium');
  const [style, setStyle] = useState<SubtitleStyle>({ ...DEFAULT_STYLE, ...(initial.style ?? {}) });
  const [proc, setProc] = useState<ProcessState>({ phase: 'idle' });
  const [currentTime, setCurrentTime] = useState(0);
  const [uiLang, setUiLang] = useState<UiLang>(() => initial.uiLang ?? detectUiLang());

  // Subtitles (independent of process phase now)
  const [srtPath, setSrtPath] = useState<string | null>(null);
  const [rawCues, setRawCues] = useState<Cue[] | null>(null);

  // Silence
  const [silenceRegions, setSilenceRegions] = useState<SilenceRegion[]>([]);
  const [thresholdDb, setThresholdDb] = useState<number>(-30);
  const [autoThreshold, setAutoThreshold] = useState<boolean>(true);
  const [meanVolumeDb, setMeanVolumeDb] = useState<number | null>(null);
  const [minSilenceDur, setMinSilenceDur] = useState<number>(0.5);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const timelineRef = useRef<SilenceTimelineHandle>(null);

  // Crop
  const [cropEnabled, setCropEnabled] = useState<boolean>(false);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [aspectId, setAspectId] = useState<string>('free');

  // Audio gain (dB) applied on export
  const [volumeDb, setVolumeDb] = useState<number>(0);

  // Custom video controls
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  // Collapsible sidebar sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    source: true, crop: true, silence: true, audio: true, transcription: true, style: true,
  });
  const toggleSection = (id: string) =>
    setOpenSections(s => ({ ...s, [id]: !s[id] }));

  useEffect(() => { saveSettings({ uiLang, language, model, style }); }, [uiLang, language, model, style]);
  const t = (k: keyof typeof TRANSLATIONS['en']) => TRANSLATIONS[uiLang][k] ?? TRANSLATIONS.en[k];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, bumpVideoEl] = useState(0);

  const cues = useMemo(
    () => rawCues ? resegmentByWords(rawCues, style.maxWords) : null,
    [rawCues, style.maxWords]
  );

  const activeCue = useMemo(() => {
    if (!cues) return null;
    return cues.find(c => currentTime >= c.start && currentTime <= c.end) ?? null;
  }, [cues, currentTime]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => { if (v.duration && isFinite(v.duration)) setVideoDuration(d => d || v.duration); };
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('volumechange', onVol);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('volumechange', onVol);
    };
  }, [videoUrl]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!videoUrl) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'm' || e.key === 'M') {
        const v = videoRef.current; if (v) v.muted = !v.muted;
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((videoRef.current?.currentTime ?? 0) - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((videoRef.current?.currentTime ?? 0) + 5); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoUrl, videoDuration]);
  function seekTo(time: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(videoDuration || time, time));
  }

  useEffect(() => {
    const off = window.subbi.onProgress((evt) => {
      if (evt.kind === 'transcribe') {
        setProc(p => p.phase === 'transcribing'
          ? { phase: 'transcribing', pct: evt.pct, log: (p.log + evt.line + '\n').slice(-2000) } : p);
      } else if (evt.kind === 'export') {
        setProc(p => p.phase === 'exporting'
          ? { phase: 'exporting', pct: evt.pct, log: (p.log + evt.line + '\n').slice(-2000) } : p);
      }
    });
    return off;
  }, []);

  function loadVideo(filePath: string) {
    setVideoPath(filePath);
    setVideoUrl('file:///' + filePath.replace(/\\/g, '/'));
    setProc({ phase: 'idle' });
    setSilenceRegions([]);
    setMeanVolumeDb(null);
    setVideoDuration(0);
    setPeaks(null);
    setSrtPath(null);
    setRawCues(null);
    setCropEnabled(false);
    setCrop(DEFAULT_CROP);
    setAspectId('free');
    setVolumeDb(0);
  }

  useEffect(() => {
    if (!videoPath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.subbi.extractPeaks({ videoPath, targetBins: 2000 });
        if (cancelled) return;
        setPeaks(res.peaks);
        setVideoDuration(d => d || res.duration);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [videoPath]);

  useEffect(() => { if (videoUrl && videoRef.current) bumpVideoEl(n => n + 1); }, [videoUrl]);

  // Skip enabled silence regions during playback.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.paused || silenceRegions.length === 0) return;
    for (const r of silenceRegions) {
      if (!r.enabled) continue;
      if (currentTime >= r.start && currentTime < r.end - 0.02) {
        const target = Math.min(r.end, (videoDuration || r.end) - 0.001);
        if (target > v.currentTime) v.currentTime = target;
        break;
      }
    }
  }, [currentTime, silenceRegions, videoDuration]);

  async function detectSilencesNow() {
    if (!videoPath) return;
    setProc({ phase: 'detecting' });
    try {
      const res = await window.subbi.detectSilences({
        videoPath,
        thresholdDb: autoThreshold ? undefined : thresholdDb,
        minDurSec: minSilenceDur,
      });
      setMeanVolumeDb(res.meanVolumeDb);
      setVideoDuration(res.duration);
      if (autoThreshold) setThresholdDb(Math.round(res.thresholdDb));
      setSilenceRegions(res.silences.map((s, i) => ({
        id: `sil-${i}-${s.start.toFixed(3)}`,
        start: s.start, end: s.end, enabled: true,
      })));
      setProc({ phase: 'idle' });
    } catch (err: any) {
      setProc({ phase: 'error', message: String(err?.message || err) });
    }
  }

  function toggleSilence(id: string) {
    setSilenceRegions(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }
  function updateSilence(id: string, start: number, end: number) {
    setSilenceRegions(rs => rs.map(r => r.id === id ? { ...r, start, end } : r));
  }

  function buildKeepRanges(): { start: number; end: number }[] {
    if (!videoDuration) return [];
    const cuts = silenceRegions.filter(r => r.enabled).map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    const keep: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const c of cuts) {
      if (c.start > cursor) keep.push({ start: cursor, end: Math.min(c.start, videoDuration) });
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < videoDuration) keep.push({ start: cursor, end: videoDuration });
    return keep.filter(k => k.end - k.start > 0.02);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const p = window.subbi.getPathForFile?.(f) || (f as any).path || '';
    if (!p) { setProc({ phase: 'error', message: t('couldNotReadPath') }); return; }
    loadVideo(p);
  }

  async function pickFile() {
    const p = await window.subbi.pickVideo();
    if (p) loadVideo(p);
  }

  async function transcribe() {
    if (!videoPath) return;
    setProc({ phase: 'transcribing', pct: 0, log: '' });
    try {
      const r = await window.subbi.transcribe({ videoPath, language, model });
      setSrtPath(r.srtPath);
      setRawCues(parseSrt(r.srt));
      setProc({ phase: 'idle' });
    } catch (err: any) {
      setProc({ phase: 'error', message: String(err?.message || err) });
    }
  }

  const enabledCount = silenceRegions.filter(r => r.enabled).length;
  const totalCutSec = silenceRegions.filter(r => r.enabled).reduce((s, r) => s + (r.end - r.start), 0);

  async function exportNow() {
    if (!videoPath) return;
    const hasSilence = enabledCount > 0;
    const hasSubs = !!(srtPath && cues && cues.length > 0);
    const hasCrop = cropEnabled;
    const hasVolume = Math.abs(volumeDb) > 0.01;
    if (!hasSilence && !hasSubs && !hasCrop && !hasVolume) {
      setProc({ phase: 'error', message: t('nothingToExport') });
      return;
    }
    setProc({ phase: 'exporting', pct: 0, log: '' });
    try {
      const out = await window.subbi.exportVideo({
        videoPath,
        keepRanges: hasSilence ? buildKeepRanges() : undefined,
        crop: hasCrop ? crop : null,
        subtitles: hasSubs ? { srtPath: srtPath!, style } : null,
        volumeDb: hasVolume ? volumeDb : 0,
      });
      setProc({ phase: 'exported', outPath: out });
    } catch (err: any) {
      setProc({ phase: 'error', message: String(err?.message || err) });
    }
  }

  const overlayStyle: React.CSSProperties = {
    bottom: `${style.marginVPct}%`,
    left: `${style.marginHPct}%`,
    right: `${-style.marginHPct}%`,
    fontFamily: style.fontName,
    fontSize: `${style.fontSize}px`,
    color: style.color,
    fontWeight: 700,
    ['--outline' as any]: style.outline,
  };

  const previewText = activeCue
    ? applyCase(activeCue.text, style.textCase)
    : applyCase(t('sampleSubtitle'), style.textCase);

  const isBusy = proc.phase === 'transcribing' || proc.phase === 'detecting' || proc.phase === 'exporting';

  const aspectRatio = ASPECT_PRESETS.find(a => a.id === aspectId)?.ratio ?? null;

  return (
    <div className="app">
      <div className="app-titlebar drag-region">
        <span className="app-titlebar-brand">SUBBI</span>
        <span className="app-titlebar-sep">—</span>
        <span className="app-titlebar-doc">
          {videoPath ? videoPath.split(/[\\/]/).pop() : t('untitledProject')}
        </span>
        <select value={uiLang} onChange={e => setUiLang(e.target.value as UiLang)} className="app-titlebar-lang no-drag">
          <option value="en">EN</option>
          <option value="es">ES</option>
        </select>
      </div>
      <div className="app-body">
      <div className={'preview' + (!videoUrl ? ' drag-region' : '')}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }}
           onDragLeave={() => setOver(false)}
           onDrop={onDrop}>
        {!videoUrl && (
          <label className={'dropzone' + (over ? ' over' : '')} onClick={pickFile}>
            <div style={{ fontSize: 42, marginBottom: 12, lineHeight: 1 }}>{over ? '⬇' : '🎬'}</div>
            <div style={{ fontSize: 18, marginBottom: 8 }}>{over ? t('dropNow') : t('dropHere')}</div>
            <div className="dropzone-hint" style={{ fontSize: 12 }}>{t('orClick')}</div>
          </label>
        )}
        {videoUrl && (
          <div className="video-wrap">
            <video
              ref={videoRef}
              src={videoUrl}
              onClick={togglePlay}
              onLoadedMetadata={() => bumpVideoEl(n => n + 1)}
            />
            <div className={'subtitle-overlay' + (activeCue ? '' : ' sample')} style={overlayStyle}>
              {previewText}
            </div>
            {cropEnabled && (
              <CropOverlay
                videoEl={videoRef.current}
                crop={crop}
                aspectRatio={aspectRatio}
                onChange={setCrop}
              />
            )}
          </div>
        )}
        {videoUrl && (
          <div className="video-controls">
            <button
              className="vc-btn"
              onClick={togglePlay}
              title={isPlaying ? `${t('pause')} (Space)` : `${t('play')} (Space)`}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a.5.5 0 0 0 .76.43l13-7.5a.5.5 0 0 0 0-.86l-13-7.5A.5.5 0 0 0 7 4.5z"/></svg>
              )}
            </button>
            <button className="vc-btn" onClick={() => seekTo(currentTime - 5)} title={t('back5s')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5v3l-4-4 4-4v3a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6z"/></svg>
            </button>
            <button className="vc-btn" onClick={() => seekTo(currentTime + 5)} title={t('fwd5s')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M11 5v3l-4-4 4-4v3a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6z"/></svg>
            </button>
            <div className="vc-time">
              <span className="vc-time-cur">{fmtTime(currentTime)}</span>
              <span className="vc-time-sep"> / </span>
              <span className="vc-time-tot">{fmtTime(videoDuration)}</span>
            </div>
            <input
              type="range"
              className="pr-range vc-seek"
              min={0}
              max={Math.max(0.01, videoDuration)}
              step={0.01}
              value={Math.min(currentTime, videoDuration || 0)}
              onChange={(e) => seekTo(+e.target.value)}
            />
            <button
              className="vc-btn"
              onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted; }}
              title={muted || volume === 0 ? `${t('unmute')} (M)` : `${t('mute')} (M)`}
            >
              {muted || volume === 0 ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.59 3L19 9.41 17.59 8 15 10.59 12.41 8 11 9.41 13.59 12 11 14.59 12.41 16 15 13.41 17.59 16 19 14.59 16.59 12z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06A6.99 6.99 0 0 1 19 12a6.99 6.99 0 0 1-5 6.71v2.06A8.99 8.99 0 0 0 21 12 8.99 8.99 0 0 0 14 3.23z"/></svg>
              )}
            </button>
            <input
              type="range"
              className="pr-range vc-volume"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = +e.target.value;
                if (+e.target.value > 0 && v.muted) v.muted = false;
              }}
            />
          </div>
        )}
        {videoUrl && (
          <div className="self-stretch w-full bg-pr-panel border-t border-pr-borderSoft p-2">
            <SilenceTimeline
              key={videoUrl}
              ref={timelineRef}
              videoEl={videoRef.current}
              peaks={peaks}
              duration={videoDuration}
              regions={silenceRegions}
              currentTime={currentTime}
              onToggleRegion={toggleSilence}
              onUpdateRegion={updateSilence}
            />
            {peaks === null && (
              <div className="text-[10px] text-pr-muted mt-1 px-1">{t('generatingWaveform')}</div>
            )}
            {silenceRegions.length > 0 && (
              <div className="text-[10px] text-pr-muted mt-1 px-1">{t('clickRegionToToggle')}</div>
            )}
          </div>
        )}
      </div>

      <aside className="pr-sidebar">

        {/* FILE */}
        <div className={'pr-section' + (openSections.source ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('source')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionSource')}</span>
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <button onClick={pickFile} disabled={isBusy} className="pr-btn pr-btn-flex">
                {videoPath ? t('openVideo') : t('openVideo')}
              </button>
            </div>
            {videoPath && (
              <div className="pr-filename" title={videoPath}>
                {videoPath.split(/[\\/]/).pop()}
              </div>
            )}
          </div>
        </div>

        {/* CROP */}
        <div className={'pr-section' + (openSections.crop ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('crop')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionCrop')}</span>
            <label className="pr-section-toggle" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={cropEnabled} disabled={!videoPath || isBusy}
                     onChange={e => setCropEnabled(e.target.checked)} />
              <span>{t('enableCrop')}</span>
            </label>
          </button>
          <div className={'pr-section-body' + (cropEnabled ? '' : ' pr-section-body-dim')}>
            <div className="pr-row">
              <span className="pr-label">{t('aspectRatio')}</span>
              <div className="pr-aspect-row">
                {ASPECT_PRESETS.map(p => (
                  <button
                    key={p.id}
                    disabled={!cropEnabled || isBusy}
                    onClick={() => setAspectId(p.id)}
                    className={'pr-chip' + (aspectId === p.id ? ' pr-chip-on' : '')}
                  >{p.label}</button>
                ))}
              </div>
            </div>
            <div className="pr-row pr-row-end">
              <button
                onClick={() => setCrop(DEFAULT_CROP)}
                disabled={!cropEnabled || isBusy}
                className="pr-btn pr-btn-ghost">
                {t('resetCrop')}
              </button>
            </div>
          </div>
        </div>

        {/* SILENCE */}
        <div className={'pr-section' + (openSections.silence ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('silence')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionSilence')}</span>
            {silenceRegions.length > 0 && (
              <span className="pr-badge">{enabledCount}/{silenceRegions.length} · −{totalCutSec.toFixed(1)}s</span>
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('threshold')}</span>
              <input type="range" min={-60} max={-10} step={1} value={thresholdDb}
                     disabled={isBusy || autoThreshold}
                     onChange={e => setThresholdDb(+e.target.value)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{thresholdDb} dB</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('minDuration')}</span>
              <input type="range" min={0.1} max={2} step={0.05} value={minSilenceDur}
                     disabled={isBusy}
                     onChange={e => setMinSilenceDur(+e.target.value)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{minSilenceDur.toFixed(2)}s</span>
            </div>
            <div className="pr-row">
              <label className="pr-check">
                <input type="checkbox" checked={autoThreshold} disabled={isBusy}
                       onChange={e => setAutoThreshold(e.target.checked)} />
                <span>{t('autoMean')}{meanVolumeDb != null ? ` · ${meanVolumeDb.toFixed(1)} dB` : ''}</span>
              </label>
            </div>
            <div className="pr-row pr-row-end">
              <button onClick={detectSilencesNow} disabled={!videoPath || isBusy} className="pr-btn">
                {proc.phase === 'detecting' ? `${t('detecting')}…` : t('detectSilences')}
              </button>
            </div>
            {silenceRegions.length === 0 && proc.phase !== 'detecting' && meanVolumeDb != null && (
              <div className="pr-hint">{t('noSilences')}</div>
            )}
          </div>
        </div>

        {/* AUDIO */}
        <div className={'pr-section' + (openSections.audio ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('audio')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('audioSection')}</span>
            {Math.abs(volumeDb) > 0.01 && (
              <span className="pr-badge">{volumeDb > 0 ? '+' : ''}{volumeDb} dB</span>
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('audioGain')}</span>
              <input type="range" min={-30} max={30} step={1} value={volumeDb}
                     disabled={!videoPath || isBusy}
                     onChange={e => setVolumeDb(+e.target.value)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{volumeDb > 0 ? '+' : ''}{volumeDb} dB</span>
            </div>
            <div className="pr-row pr-row-end">
              <button
                onClick={() => setVolumeDb(0)}
                disabled={!videoPath || isBusy || volumeDb === 0}
                className="pr-btn pr-btn-ghost">
                {t('resetCrop')}
              </button>
            </div>
            <div className="pr-hint">{t('audioGainHint')}</div>
          </div>
        </div>

        {/* TRANSCRIPTION */}
        <div className={'pr-section' + (openSections.transcription ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('transcription')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">Transcription</span>
            {cues && <span className="pr-badge">{cues.length} cues</span>}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('language')}</span>
              <select value={language} onChange={e => setLanguage(e.target.value)} disabled={isBusy} className="pr-input pr-input-flex">
                <option value="es">{t('langSpanish')}</option>
                <option value="en">{t('langEnglish')}</option>
                <option value="pt">{t('langPortuguese')}</option>
                <option value="auto">{t('langAuto')}</option>
              </select>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('model')}</span>
              <select value={model} onChange={e => setModel(e.target.value as any)} disabled={isBusy} className="pr-input pr-input-flex">
                <option value="tiny">{t('modelTiny')}</option>
                <option value="medium">{t('modelMedium')}</option>
                <option value="large">{t('modelLarge')}</option>
              </select>
            </div>
            <div className="pr-row pr-row-end">
              <button onClick={transcribe} disabled={!videoPath || isBusy} className="pr-btn">
                {proc.phase === 'transcribing' ? `${t('transcribing')}… ${proc.pct.toFixed(0)}%` : t('transcribe')}
              </button>
            </div>
          </div>
        </div>

        {/* SUBTITLE STYLE */}
        <div className={'pr-section' + (openSections.style ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('style')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">Subtitle style</span>
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('font')}</span>
              <select value={style.fontName} onChange={e => setStyle(s => ({ ...s, fontName: e.target.value }))} className="pr-input pr-input-flex">
                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('size')}</span>
              <input type="range" min={12} max={80} value={style.fontSize}
                     onChange={e => setStyle(s => ({ ...s, fontSize: +e.target.value }))}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.fontSize}px</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('vertical')}</span>
              <input type="range" min={0} max={45} value={style.marginVPct}
                     onChange={e => setStyle(s => ({ ...s, marginVPct: +e.target.value }))}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.marginVPct}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('horizontal')}</span>
              <input type="range" min={-40} max={40} value={style.marginHPct}
                     onChange={e => setStyle(s => ({ ...s, marginHPct: +e.target.value }))}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.marginHPct > 0 ? '+' : ''}{style.marginHPct}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('color')}</span>
              <input type="color" value={style.color}
                     onChange={e => setStyle(s => ({ ...s, color: e.target.value }))}
                     className="pr-color" />
              <span className="pr-label pr-label-mid">{t('outline')}</span>
              <input type="color" value={style.outline}
                     onChange={e => setStyle(s => ({ ...s, outline: e.target.value }))}
                     className="pr-color" />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('textCase')}</span>
              <select value={style.textCase} onChange={e => setStyle(s => ({ ...s, textCase: e.target.value as any }))} className="pr-input pr-input-flex">
                <option value="asis">{t('caseAsIs')}</option>
                <option value="upper">{t('caseUpper')}</option>
                <option value="lower">{t('caseLower')}</option>
              </select>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('maxPerLine')}</span>
              <input type="number" min={1} max={12} value={style.maxWords}
                     onChange={e => setStyle(s => ({ ...s, maxWords: +e.target.value }))}
                     className="pr-input pr-input-num" />
            </div>
          </div>
        </div>

        {/* STATUS */}
        {(proc.phase === 'transcribing' || proc.phase === 'exporting') && (
          <div className="pr-status">
            <div className="pr-progress">
              <div className="pr-progress-bar" style={{ width: `${proc.pct}%` }} />
            </div>
            <pre className="pr-log">{proc.log}</pre>
          </div>
        )}
        {proc.phase === 'exported' && (
          <div className="pr-toast pr-toast-ok">✓ {proc.outPath}</div>
        )}
        {proc.phase === 'error' && (
          <div className="pr-toast pr-toast-err">✕ {proc.message}</div>
        )}

        {/* EXPORT FOOTER */}
        <div className="pr-export">
          <div className="pr-export-meta">
            <span className={'pr-pill' + (cropEnabled ? ' on' : '')}>CROP</span>
            <span className={'pr-pill' + (enabledCount > 0 ? ' on' : '')}>SILENCE {enabledCount > 0 ? enabledCount : ''}</span>
            <span className={'pr-pill' + (cues && cues.length > 0 ? ' on' : '')}>SUBS {cues && cues.length > 0 ? cues.length : ''}</span>
          </div>
          <button
            onClick={exportNow}
            disabled={!videoPath || isBusy}
            className={'pr-export-btn' + (proc.phase === 'exported' ? ' is-done' : '')}
          >
            {proc.phase === 'exporting'
              ? `${t('exporting').toUpperCase()} ${proc.pct.toFixed(0)}%`
              : proc.phase === 'exported'
                ? `✓ ${t('exportDone').toUpperCase()}`
                : t('exportNow').toUpperCase()}
          </button>
        </div>
      </aside>
      </div>
    </div>
  );
}
