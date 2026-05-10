import React, { useEffect, useMemo, useRef, useState } from 'react';
import SilenceTimeline, { type SilenceRegion, type SilenceTimelineHandle } from './SilenceTimeline';
import CropOverlay, { type CropRect } from './CropOverlay';
import Select from './Select';
import ColorPicker from './ColorPicker';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type Cue = { start: number; end: number; text: string; edited?: boolean };

type SubtitleStyle = {
  fontName: string;
  fontSize: number;
  color: string;
  outline: string;
  outlineEnabled: boolean;
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
  outlineEnabled: true,
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
    sampleSubtitle: 'Sample subtitle',
    clickToEditCue: 'Click to edit subtitle (Enter to save · Esc to cancel)',
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
    notAVideo: 'Only video files are accepted (mp4, mov, mkv, webm, avi, m4v).',
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
    disableCrop: 'Disable',
    cropPixels: 'Pixels',
    cropX: 'X',
    cropY: 'Y',
    cropW: 'W',
    cropH: 'H',
    audioSection: 'Audio',
    audioGain: 'Volume gain',
    audioGainHint: 'Boost or attenuate the audio track on export.',
    audioGate: 'Noise gate',
    audioGateHint: 'Mute audio below the threshold (keeps voice, drops low-level noise).',
    audioGateOff: 'Off',
    exportSection: 'Export',
    exportNow: 'Export video',
    exporting: 'Exporting',
    exportDone: 'Export complete',
    nothingToExport: 'No edits to export — nothing to do.',
    showInFolder: 'Show in folder',
    untitledProject: 'Untitled Project',
    sectionCrop: 'Crop',
    sectionSilence: 'Silence',
    sectionTranscription: 'Transcription',
    sectionSubtitleStyle: 'Subtitle style',
    cues: 'cues',
    generatingWaveform: 'Generating waveform…',
    pillSilence: 'SILENCE',
    pillSubs: 'SUBS',
    pillCrop: 'CROP',
    pillAudio: 'AUDIO',
    aspectFree: 'Free',
    pause: 'Pause',
    play: 'Play',
    mute: 'Mute',
    unmute: 'Unmute',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Reset',
    splitHere: 'Split here',
    removeSplit: 'Remove split',
    splitsBadge: 'splits',
    exportPartsHint: 'Export will produce one file per segment.',
    zoomTimeline: 'Zoom timeline',
    zoomReset: 'Reset zoom',
    'log.transcribe.extractingAudio': 'Preparing audio…',
    'log.transcribe.extractingProgress': 'Preparing audio: {pct}%',
    'log.transcribe.audioReady': 'Audio ready.',
    'log.transcribe.starting': 'Generating subtitles…',
    'log.transcribe.progress': 'Generating subtitles: {pct}%',
    'log.transcribe.savingSubtitles': 'Saving subtitle file…',
    'log.transcribe.done': 'Subtitles ready.',
    'log.export.starting': 'Preparing export…',
    'log.export.progress': 'Exporting: {pct}%',
    'log.export.done': 'Export finished.',
    'log.cut.starting': 'Trimming silences…',
    'log.cut.progress': 'Trimming: {pct}%',
    'log.cut.done': 'Trim finished.',
    'log.burn.starting': 'Burning subtitles…',
    'log.burn.progress': 'Burning: {pct}%',
    'log.burn.done': 'Burn finished.',
    'err.engineMissing': 'A required component is missing.',
    'err.transcriberMissing': 'The transcription engine is missing.',
    'err.modelMissing': 'The transcription model is missing.',
    'err.audioPrep': 'Could not prepare the audio for transcription.',
    'err.transcribe': 'Transcription failed.',
    'err.subtitlesMissing': 'No subtitles were produced.',
    'err.export': 'Export failed.',
    'err.cut': 'Trimming failed.',
    'err.burn': 'Subtitle burn failed.',
    'err.duration': 'Could not read the video duration.',
    'err.waveform': 'Could not generate the waveform.',
    'err.noSegments': 'There are no segments to keep.',
    storageLabel: 'Saved · {size}',
    storageTooltip: 'Auto-saved edits use {total} across {count} project(s). Other projects: {others} ({othersCount}).',
    clearOthers: 'Clear others',
    clearOthersTitle: 'Remove auto-saved data for {count} other project(s) — frees {size}.',
    clearOthersNone: 'No other projects saved.',
    confirmClearOthers: 'Remove auto-saved edits for {count} other project(s)? This will free {size}. The current project is kept.',
    resetEdits: 'Reset edits',
    resetEditsTitle: 'Remove all edits and start from scratch (keeps the transcription).',
    resetConfirm: 'Click again to confirm',
    resetSection: 'Reset',
    resetSectionTitle: 'Reset this section to defaults',
    themeSystem: 'Theme: System (click to switch to Light)',
    themeLight: 'Theme: Light (click to switch to Dark)',
    themeDark: 'Theme: Dark (click to switch to System)',
    resetNothing: 'Nothing to reset.',
  },
  es: {
    openVideo: 'Abrir video',
    dropHere: 'Soltá un video aquí',
    dropNow: 'Soltalo ahora',
    sampleSubtitle: 'Subtítulo de ejemplo',
    clickToEditCue: 'Click para editar el subtítulo (Enter para guardar · Esc para cancelar)',
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
    notAVideo: 'Solo se aceptan archivos de video (mp4, mov, mkv, webm, avi, m4v).',
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
    disableCrop: 'Desactivar',
    cropPixels: 'Píxeles',
    cropX: 'X',
    cropY: 'Y',
    cropW: 'W',
    cropH: 'H',
    audioSection: 'Audio',
    audioGain: 'Ganancia de volumen',
    audioGainHint: 'Subí o bajá el audio del video al exportar.',
    audioGate: 'Puerta de ruido',
    audioGateHint: 'Silencia el audio por debajo del umbral (mantiene la voz, baja el ruido).',
    audioGateOff: 'Apagada',
    exportSection: 'Exportar',
    exportNow: 'Exportar video',
    exporting: 'Exportando',
    exportDone: 'Exportación completa',
    nothingToExport: 'No hay ediciones para exportar.',
    showInFolder: 'Mostrar en carpeta',
    untitledProject: 'Proyecto sin título',
    sectionCrop: 'Recortar',
    sectionSilence: 'Silencios',
    sectionTranscription: 'Transcripción',
    sectionSubtitleStyle: 'Estilo del subtítulo',
    cues: 'subtítulos',
    generatingWaveform: 'Generando forma de onda…',
    pillSilence: 'SILENCIO',
    pillSubs: 'SUBS',
    pillCrop: 'RECORTE',
    pillAudio: 'AUDIO',
    aspectFree: 'Libre',
    pause: 'Pausar',
    play: 'Reproducir',
    mute: 'Silenciar',
    unmute: 'Activar audio',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Restablecer',
    splitHere: 'Cortar aquí',
    removeSplit: 'Quitar corte',
    splitsBadge: 'cortes',
    exportPartsHint: 'Se exportará un archivo por cada segmento.',
    zoomTimeline: 'Zoom de la timeline',
    zoomReset: 'Restablecer zoom',
    'log.transcribe.extractingAudio': 'Preparando audio…',
    'log.transcribe.extractingProgress': 'Preparando audio: {pct}%',
    'log.transcribe.audioReady': 'Audio listo.',
    'log.transcribe.starting': 'Generando subtítulos…',
    'log.transcribe.progress': 'Generando subtítulos: {pct}%',
    'log.transcribe.savingSubtitles': 'Guardando archivo de subtítulos…',
    'log.transcribe.done': 'Subtítulos listos.',
    'log.export.starting': 'Preparando exportación…',
    'log.export.progress': 'Exportando: {pct}%',
    'log.export.done': 'Exportación finalizada.',
    'log.cut.starting': 'Quitando silencios…',
    'log.cut.progress': 'Quitando silencios: {pct}%',
    'log.cut.done': 'Silencios quitados.',
    'log.burn.starting': 'Incrustando subtítulos…',
    'log.burn.progress': 'Incrustando: {pct}%',
    'log.burn.done': 'Subtítulos incrustados.',
    'err.engineMissing': 'Falta un componente requerido.',
    'err.transcriberMissing': 'Falta el motor de transcripción.',
    'err.modelMissing': 'Falta el modelo de transcripción.',
    'err.audioPrep': 'No se pudo preparar el audio para transcribir.',
    'err.transcribe': 'La transcripción falló.',
    'err.subtitlesMissing': 'No se generaron subtítulos.',
    'err.export': 'La exportación falló.',
    'err.cut': 'No se pudieron quitar los silencios.',
    'err.burn': 'No se pudieron incrustar los subtítulos.',
    'err.duration': 'No se pudo leer la duración del video.',
    'err.waveform': 'No se pudo generar la forma de onda.',
    'err.noSegments': 'No hay segmentos para conservar.',
    storageLabel: 'Guardado · {size}',
    storageTooltip: 'Las ediciones autoguardadas ocupan {total} en {count} proyecto(s). Otros proyectos: {others} ({othersCount}).',
    clearOthers: 'Limpiar otros',
    clearOthersTitle: 'Borrar el autoguardado de {count} proyecto(s) — libera {size}.',
    clearOthersNone: 'No hay otros proyectos guardados.',
    confirmClearOthers: '¿Borrar las ediciones autoguardadas de {count} proyecto(s)? Vas a liberar {size}. El proyecto actual se conserva.',
    resetEdits: 'Restablecer edits',
    resetEditsTitle: 'Quitar todas las ediciones y arrancar desde cero (la transcripción se conserva).',
    resetConfirm: 'Click de nuevo para confirmar',
    resetSection: 'Restablecer',
    resetSectionTitle: 'Restablecer esta sección a sus valores por defecto',
    resetNothing: 'No hay nada que restablecer.',
    themeSystem: 'Tema: Sistema (clic para cambiar a Claro)',
    themeLight: 'Tema: Claro (clic para cambiar a Oscuro)',
    themeDark: 'Tema: Oscuro (clic para cambiar a Sistema)',
  },
};

function detectUiLang(): UiLang {
  const nav = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || '';
  const langs = (typeof navigator !== 'undefined' && (navigator as any).languages) || [nav];
  for (const l of langs) if (typeof l === 'string' && l.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

type ThemePref = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
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

function formatSrt(cues: Cue[]): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const fmt = (sec: number) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`)
    .join('\n');
}

function resegmentByWords(cues: Cue[], maxWords: number): Cue[] {
  if (!maxWords || maxWords <= 0) return cues;
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.edited) { out.push(c); continue; }
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

// Compact tick label for the timeline ruler. Shows tenths only when the tick
// interval is sub-second so labels stay readable at low zoom.
function fmtRulerTime(sec: number, intervalSec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (intervalSec < 1) {
    const s = sec % 60;
    return `${pad(m)}:${s.toFixed(1).padStart(4, '0')}`;
  }
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Choose a "nice" tick spacing in seconds for a given target spacing.
function pickRulerInterval(targetSec: number): number {
  const niceSeconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const n of niceSeconds) if (n >= targetSec) return n;
  return niceSeconds[niceSeconds.length - 1];
}

const STORAGE_KEY = 'subbi:settings:v2';
const PROJECT_PREFIX = 'subbi:proj:v1:';
const LAST_VIDEO_KEY = 'subbi:lastVideoPath:v1';

type ProjectState = {
  silenceRegions: SilenceRegion[];
  thresholdDb: number;
  autoThreshold: boolean;
  meanVolumeDb: number | null;
  minSilenceDur: number;
  cropEnabled: boolean;
  crop: CropRect;
  aspectId: string;
  volumeDb: number;
  noiseGateDb: number;
  noiseGateEnabled: boolean;
  srtPath: string | null;
  rawCues: Cue[] | null;
  style: SubtitleStyle;
  language: string;
  model: 'tiny' | 'medium' | 'large';
  splitMarkers?: number[];
};

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];

function isVideoPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase());
}

function projectKey(videoPath: string): string {
  return PROJECT_PREFIX + videoPath;
}

function loadProject(videoPath: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(projectKey(videoPath));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p as ProjectState : null;
  } catch { return null; }
}

function saveProject(videoPath: string, state: ProjectState) {
  try { localStorage.setItem(projectKey(videoPath), JSON.stringify(state)); } catch {}
}

function autosaveStats(currentVideoPath: string | null): { total: number; others: number; count: number; othersCount: number } {
  let total = 0;
  let others = 0;
  let count = 0;
  let othersCount = 0;
  const currentKey = currentVideoPath ? projectKey(currentVideoPath) : null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PROJECT_PREFIX)) continue;
      const v = localStorage.getItem(k) ?? '';
      const bytes = (k.length + v.length) * 2;
      total += bytes;
      count += 1;
      if (k !== currentKey) { others += bytes; othersCount += 1; }
    }
  } catch { /* ignore */ }
  return { total, others, count, othersCount };
}

function clearOtherProjects(currentVideoPath: string | null): number {
  const currentKey = currentVideoPath ? projectKey(currentVideoPath) : null;
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PROJECT_PREFIX)) continue;
      if (k === currentKey) continue;
      toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* ignore */ }
  return toRemove.length;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const rounded = v >= 100 || i === 0 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${rounded} ${units[i]}`;
}

type PersistedSettings = {
  uiLang?: UiLang;
  language?: string;
  model?: 'tiny' | 'medium' | 'large';
  style?: SubtitleStyle;
  theme?: ThemePref;
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

// Build the inline style for a Premiere-flat range so the filled portion is lila.
function rangePct(value: number, min: number, max: number): React.CSSProperties {
  if (max === min) return { ['--pct' as any]: '0%' };
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return { ['--pct' as any]: `${pct}%` };
}

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
  const [themePref, setThemePref] = useState<ThemePref>(() => initial.theme ?? 'system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(initial.theme ?? 'system'));

  // Subtitles (independent of process phase now)
  const [srtPath, setSrtPath] = useState<string | null>(null);
  const [rawCues, setRawCues] = useState<Cue[] | null>(null);
  // Inline subtitle editing on the preview overlay
  const [editingCue, setEditingCue] = useState<Cue | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // Silence
  const [silenceRegions, setSilenceRegions] = useState<SilenceRegion[]>([]);
  const [thresholdDb, setThresholdDb] = useState<number>(-30);
  const [autoThreshold, setAutoThreshold] = useState<boolean>(true);
  const [meanVolumeDb, setMeanVolumeDb] = useState<number | null>(null);
  const [minSilenceDur, setMinSilenceDur] = useState<number>(0.5);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const timelineRef = useRef<SilenceTimelineHandle>(null);

  // Timeline zoom (1 = fit, up to 10x). Both seek bar and waveform scale together.
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const lastZoomRef = useRef<number>(1);

  // Hover frame preview over seek/timeline. Position is in viewport coords.
  const [hoverPreview, setHoverPreview] = useState<
    { time: number; clientX: number; topY: number } | null
  >(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Width of the timeline scroll viewport — used to pick a tick spacing that
  // keeps the ruler from getting too dense or too sparse.
  const [scrollViewportW, setScrollViewportW] = useState<number>(800);

  // Crop
  const [cropEnabled, setCropEnabled] = useState<boolean>(false);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [aspectId, setAspectId] = useState<string>('free');

  // Audio gain (dB) applied on export
  const [volumeDb, setVolumeDb] = useState<number>(0);
  // Noise gate threshold (dB) — anything below is silenced. -60..-1.
  const [noiseGateDb, setNoiseGateDb] = useState<number>(-40);
  const [noiseGateEnabled, setNoiseGateEnabled] = useState<boolean>(false);

  // Split markers (sorted ascending). On export, produce one file per segment between markers.
  const [splitMarkers, setSplitMarkers] = useState<number[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);

  function addSplitAtCurrent() {
    if (!videoDuration) return;
    const t = Math.max(0, Math.min(videoDuration, currentTime));
    setSplitMarkers(prev => {
      // Avoid duplicates within ~50ms.
      if (prev.some(m => Math.abs(m - t) < 0.05)) return prev;
      return [...prev, t].sort((a, b) => a - b);
    });
  }
  function removeSelectedMarker() {
    if (selectedMarker == null) return;
    setSplitMarkers(prev => prev.filter(m => Math.abs(m - selectedMarker) > 1e-6));
    setSelectedMarker(null);
  }

  // Two-stage confirm for reset buttons. Tracks which key (e.g. 'all', 'crop'…)
  // is currently awaiting a second click. Auto-cancels on outside click & timeout.
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  function armReset(key: string) {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    setConfirmReset(key);
    confirmTimerRef.current = window.setTimeout(() => setConfirmReset(null), 3500);
  }
  function clearArmedReset() {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmReset(null);
  }
  useEffect(() => {
    if (!confirmReset) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-reset-key="' + confirmReset + '"]')) return;
      clearArmedReset();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [confirmReset]);

  function resetCrop() {
    setCrop(DEFAULT_CROP);
    setAspectId('free');
    setCropEnabled(false);
  }
  function resetSilence() {
    setSilenceRegions([]);
    setThresholdDb(-30);
    setAutoThreshold(true);
    setMinSilenceDur(0.5);
  }
  function resetAudio() {
    setVolumeDb(0);
    setNoiseGateDb(-40);
    setNoiseGateEnabled(false);
  }
  function resetStyle() { setStyle({ ...DEFAULT_STYLE }); }
  function resetSplits() {
    setSplitMarkers([]);
    setSelectedMarker(null);
  }
  function renderSectionReset(key: string, run: () => void, canReset: boolean) {
    const armed = confirmReset === key;
    return (
      <span
        role="button"
        data-reset-key={key}
        className={'pr-section-reset' + (armed ? ' is-confirming' : '') + (!canReset ? ' is-disabled' : '')}
        title={armed ? t('resetConfirm') : t('resetSectionTitle')}
        aria-disabled={!canReset}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!canReset) return;
          if (armed) { run(); clearArmedReset(); }
          else armReset(key);
        }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 9 8 9" />
        </svg>
      </span>
    );
  }

  function resetAllEdits() {
    resetCrop();
    resetSilence();
    resetAudio();
    resetStyle();
    resetSplits();
    // Drop any inline cue edit in progress and re-segment from raw transcription.
    setEditingCue(null);
    setEditingText('');
  }

  // Custom video controls
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(1); // 1 = fit
  const ZOOM_MIN = 0.25, ZOOM_MAX = 4;
  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

  function zoomIn() {
    setPreviewZoom(z => {
      const next = ZOOM_STEPS.find(s => s > z + 0.001);
      return next ?? ZOOM_MAX;
    });
  }
  function zoomOut() {
    setPreviewZoom(z => {
      const next = [...ZOOM_STEPS].reverse().find(s => s < z - 0.001);
      return next ?? ZOOM_MIN;
    });
  }
  function zoomFit() { setPreviewZoom(1); }
  function zoomActual() {
    const v = videoRef.current;
    if (!v?.videoWidth || !v.parentElement) { setPreviewZoom(1); return; }
    const stage = v.parentElement;
    const fitW = Math.min(v.videoWidth, stage.clientWidth);
    setPreviewZoom(v.videoWidth / fitW);
  }

  // Collapsible sidebar sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    crop: true, silence: true, audio: true, transcription: true, style: true,
  });
  const toggleSection = (id: string) =>
    setOpenSections(s => ({ ...s, [id]: !s[id] }));

  useEffect(() => { saveSettings({ uiLang, language, model, style, theme: themePref }); }, [uiLang, language, model, style, themePref]);

  useEffect(() => {
    const next = resolveTheme(themePref);
    setResolvedTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  }, [themePref]);

  useEffect(() => {
    if (themePref !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? 'light' : 'dark';
      setResolvedTheme(next);
      document.documentElement.setAttribute('data-theme', next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  const cycleTheme = () => {
    setThemePref(p => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  };

  useEffect(() => { setStorageStats(autosaveStats(videoPath)); }, [videoPath]);

  // Block context menu, refresh shortcuts and devtools shortcuts at the renderer level too.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (k === 'f5' || (ctrlOrMeta && k === 'r')) { e.preventDefault(); return; }
      if (k === 'f12') { e.preventDefault(); return; }
      if (ctrlOrMeta && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) { e.preventDefault(); return; }
      if (ctrlOrMeta && k === 'u') { e.preventDefault(); return; }
    };
    const onSelectStart = (e: Event) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const el = e.target as HTMLElement | null;
      if (el && el.isContentEditable) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey, { capture: true });
    document.addEventListener('selectstart', onSelectStart);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey, { capture: true } as any);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }, []);

  const t = (k: keyof typeof TRANSLATIONS['en']) => TRANSLATIONS[uiLang][k] ?? TRANSLATIONS.en[k];
  // Translate a backend-emitted event key like "evt:transcribe.progress:42" or
  // "evt:err.transcribe" into a clean, localized message. Returns '' for unknown keys.
  // Tolerates IPC wrappers that prefix the message ("Error: evt:..." etc.).
  const tEvt = (raw: string): string => {
    if (!raw) return '';
    const m = raw.match(/evt:([A-Za-z]+\.[A-Za-z]+)(?::([0-9]+))?/);
    if (!m) return '';
    const key = m[1];
    const arg = m[2] ?? '';
    const lookup = key.startsWith('err.') ? key : `log.${key}`;
    const tbl = TRANSLATIONS[uiLang] as Record<string, string>;
    const en = TRANSLATIONS.en as Record<string, string>;
    const tpl = tbl[lookup] ?? en[lookup];
    if (!tpl) return '';
    return tpl.replace('{pct}', arg);
  };
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

  // Apply playback rate whenever it changes or video reloads.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate, videoUrl]);

  // Load the hidden preview video with the same source so hover scrubbing is instant.
  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (videoUrl) {
      if (pv.src !== videoUrl) pv.src = videoUrl;
      pv.muted = true;
      try { pv.load(); } catch {}
    } else {
      try { pv.removeAttribute('src'); pv.load(); } catch {}
    }
  }, [videoUrl]);

  // Seek the preview video as the hover position changes.
  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv || !hoverPreview) return;
    const t = Math.max(0, Math.min((pv.duration || hoverPreview.time + 1) - 0.05, hoverPreview.time));
    if (Math.abs(pv.currentTime - t) > 0.05) {
      try { pv.currentTime = t; } catch {}
    }
  }, [hoverPreview]);

  // Track the timeline scroll viewport width so the ruler can adapt its tick density.
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const update = () => setScrollViewportW(el.clientWidth || 0);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [videoUrl]);

  // When zoom changes, keep the cursor (currentTime) under the same horizontal viewport
  // position. This avoids jumping to t=0 when zooming in.
  useEffect(() => {
    const el = timelineScrollRef.current;
    const dur = videoDuration;
    const prev = lastZoomRef.current;
    lastZoomRef.current = timelineZoom;
    if (!el || !dur || prev === timelineZoom) return;
    const viewport = el.clientWidth;
    const innerWidth = viewport * timelineZoom;
    const cursorX = (currentTime / dur) * innerWidth;
    const target = Math.max(0, Math.min(innerWidth - viewport, cursorX - viewport / 2));
    el.scrollLeft = target;
  }, [timelineZoom, videoDuration, currentTime]);

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
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoomFit(); }
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
      const msg = tEvt(evt.line);
      if (evt.kind === 'transcribe') {
        setProc(p => p.phase === 'transcribing'
          ? { phase: 'transcribing', pct: evt.pct, log: msg ? (p.log + msg + '\n').slice(-2000) : p.log } : p);
      } else if (evt.kind === 'export') {
        setProc(p => p.phase === 'exporting'
          ? { phase: 'exporting', pct: evt.pct, log: msg ? (p.log + msg + '\n').slice(-2000) : p.log } : p);
      }
    });
    return off;
  }, [uiLang]);

  // Tracks whether the load just happened so the autosave effect doesn't immediately
  // re-write the freshly-restored state (which would be a no-op but adds noise).
  const justLoadedRef = useRef(false);
  const [autosaveTick, setAutosaveTick] = useState<'idle' | 'saved'>('idle');
  const [storageStats, setStorageStats] = useState<{ total: number; others: number; count: number; othersCount: number }>(
    () => autosaveStats(null)
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_VIDEO_KEY); } catch {}
      if (!last) return;
      const exists = await window.subbi.pathExists?.(last).catch(() => false);
      if (cancelled) return;
      if (exists) loadVideo(last);
      else { try { localStorage.removeItem(LAST_VIDEO_KEY); } catch {} }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadVideo(filePath: string) {
    if (videoPath && videoPath !== filePath) {
      saveProject(videoPath, {
        silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
        cropEnabled, crop, aspectId, volumeDb, noiseGateDb, noiseGateEnabled,
        srtPath, rawCues, style, language, model,
        splitMarkers,
      });
    }
    setVideoPath(filePath);
    setVideoUrl('file:///' + filePath.replace(/\\/g, '/'));
    setProc({ phase: 'idle' });
    setVideoDuration(0);
    setPeaks(null);
    try { localStorage.setItem(LAST_VIDEO_KEY, filePath); } catch {}

    const saved = loadProject(filePath);
    justLoadedRef.current = true;
    if (saved) {
      setSilenceRegions(saved.silenceRegions ?? []);
      setThresholdDb(saved.thresholdDb ?? -30);
      setAutoThreshold(saved.autoThreshold ?? true);
      setMeanVolumeDb(saved.meanVolumeDb ?? null);
      setMinSilenceDur(saved.minSilenceDur ?? 0.5);
      setCropEnabled(saved.cropEnabled ?? false);
      setCrop(saved.crop ?? DEFAULT_CROP);
      setAspectId(saved.aspectId ?? 'free');
      setVolumeDb(saved.volumeDb ?? 0);
      setNoiseGateDb(saved.noiseGateDb ?? -40);
      setNoiseGateEnabled(saved.noiseGateEnabled ?? false);
      setSrtPath(saved.srtPath ?? null);
      setRawCues(saved.rawCues ?? null);
      setSplitMarkers(saved.splitMarkers ?? []);
      if (saved.style) setStyle({ ...DEFAULT_STYLE, ...saved.style });
      if (saved.language) setLanguage(saved.language);
      if (saved.model) setModel(saved.model);
    } else {
      setSilenceRegions([]);
      setMeanVolumeDb(null);
      setSrtPath(null);
      setRawCues(null);
      setCropEnabled(false);
      setCrop(DEFAULT_CROP);
      setAspectId('free');
      setVolumeDb(0);
      setNoiseGateDb(-40);
      setNoiseGateEnabled(false);
      setSplitMarkers([]);
    }
    setSelectedMarker(null);
  }

  // Autosave: persist the current edit state for this video (debounced).
  useEffect(() => {
    if (!videoPath) return;
    if (justLoadedRef.current) { justLoadedRef.current = false; return; }
    const handle = setTimeout(() => {
      saveProject(videoPath, {
        silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
        cropEnabled, crop, aspectId, volumeDb, noiseGateDb, noiseGateEnabled,
        srtPath, rawCues, style, language, model,
        splitMarkers,
      });
      setAutosaveTick('saved');
      setStorageStats(autosaveStats(videoPath));
      const t = setTimeout(() => setAutosaveTick('idle'), 1200);
      return () => clearTimeout(t);
    }, 400);
    return () => clearTimeout(handle);
  }, [videoPath, silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
      cropEnabled, crop, aspectId, volumeDb, noiseGateDb, noiseGateEnabled,
      srtPath, rawCues, style, language, model,
      splitMarkers]);

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
      setProc({ phase: 'error', message: tEvt(String(err?.message || err)) || String(err?.message || err) });
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
    if (!isVideoPath(p)) { setProc({ phase: 'error', message: t('notAVideo') }); return; }
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
      setProc({ phase: 'error', message: tEvt(String(err?.message || err)) || String(err?.message || err) });
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
    const hasGate = noiseGateEnabled && noiseGateDb < -0.01;
    const hasSplits = splitMarkers.length > 0;
    if (!hasSilence && !hasSubs && !hasCrop && !hasVolume && !hasGate && !hasSplits) {
      setProc({ phase: 'error', message: t('nothingToExport') });
      return;
    }

    // Build segments: bounded by split markers.
    const cuts = [...splitMarkers].sort((a, b) => a - b);
    const segmentBounds: { start: number; end: number }[] = [];
    let prev = 0;
    for (const c of cuts) {
      if (c > prev + 0.02) segmentBounds.push({ start: prev, end: c });
      prev = c;
    }
    if (videoDuration > prev + 0.02) segmentBounds.push({ start: prev, end: videoDuration });
    if (segmentBounds.length === 0) segmentBounds.push({ start: 0, end: videoDuration });

    // Within each segment, intersect with silence-keep ranges.
    const baseKeep = hasSilence ? buildKeepRanges() : null;
    function rangesForSegment(seg: { start: number; end: number }) {
      if (!baseKeep) return [{ start: seg.start, end: seg.end }];
      return baseKeep
        .map(r => ({ start: Math.max(r.start, seg.start), end: Math.min(r.end, seg.end) }))
        .filter(r => r.end - r.start > 0.02);
    }

    // Output paths.
    const sep = videoPath.includes('\\') ? '\\' : '/';
    const dir = videoPath.substring(0, videoPath.lastIndexOf(sep));
    const file = videoPath.substring(videoPath.lastIndexOf(sep) + 1);
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.substring(0, dot) : file;
    const ext = dot > 0 ? file.substring(dot) : '.mp4';
    const multi = segmentBounds.length > 1;

    setProc({ phase: 'exporting', pct: 0, log: '' });
    try {
      const outputs: string[] = [];
      const total = segmentBounds.length;
      for (let i = 0; i < total; i++) {
        const seg = segmentBounds[i];
        const segKeep = rangesForSegment(seg);
        if (segKeep.length === 0) continue;
        const useKeep = hasSilence || multi;
        const outName = multi ? `${base}.subbi.${i + 1}${ext}` : `${base}.subbi${ext}`;
        const outputPath = `${dir}${sep}${outName}`;
        // If any cue was edited inline, the SRT on disk already holds the
        // resegmented form with the user's atoms; tell the burner not to
        // re-split (would undo the user's added words).
        const hasEditedCues = !!(rawCues && rawCues.some(c => c.edited));
        const burnStyle = hasEditedCues ? { ...style, maxWords: 0 } : style;
        const segOut = await window.subbi.exportVideo({
          videoPath,
          keepRanges: useKeep ? segKeep : undefined,
          crop: hasCrop ? crop : null,
          subtitles: hasSubs ? { srtPath: srtPath!, style: burnStyle } : null,
          volumeDb: hasVolume ? volumeDb : 0,
          noiseGateDb: hasGate ? noiseGateDb : null,
          outputPath,
        });
        outputs.push(segOut);
        setProc(p => p.phase === 'exporting'
          ? { ...p, pct: Math.min(100, ((i + 1) / total) * 100) }
          : p);
      }
      setProc({ phase: 'exported', outPath: multi ? `${outputs.length} files in ${dir}` : outputs[0] });
    } catch (err: any) {
      setProc({ phase: 'error', message: tEvt(String(err?.message || err)) || String(err?.message || err) });
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
    ['--outline' as any]: style.outlineEnabled ? style.outline : 'transparent',
    textShadow: style.outlineEnabled ? undefined : 'none',
  };

  function beginEditCue() {
    if (!activeCue) return;
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setEditingCue(activeCue);
    setEditingText(activeCue.text);
  }

  function cancelEditCue() {
    setEditingCue(null);
    setEditingText('');
  }

  function commitEditCue() {
    if (!editingCue) return;
    const target = editingCue;
    const newText = editingText.replace(/\s+$/g, '');
    if (!newText.trim() || newText === target.text || !rawCues) {
      cancelEditCue();
      return;
    }
    const flattened = resegmentByWords(rawCues, style.maxWords);
    const updated = flattened.map(c =>
      Math.abs(c.start - target.start) < 1e-6 && Math.abs(c.end - target.end) < 1e-6
        ? { ...c, text: newText, edited: true }
        : c
    );
    setRawCues(updated);
    if (srtPath) {
      window.subbi.writeSrt({ srtPath, content: formatSrt(updated) }).catch(() => { /* ignore */ });
    }
    cancelEditCue();
  }

  const previewText = activeCue
    ? applyCase(activeCue.text, style.textCase)
    : applyCase(t('sampleSubtitle'), style.textCase);

  const isBusy = proc.phase === 'transcribing' || proc.phase === 'detecting' || proc.phase === 'exporting';

  const aspectRatio = ASPECT_PRESETS.find(a => a.id === aspectId)?.ratio ?? null;

  // Pixel inputs for crop (derived from normalized values + intrinsic video size).
  const videoW = videoRef.current?.videoWidth ?? 0;
  const videoH = videoRef.current?.videoHeight ?? 0;
  const cropPxX = videoW ? Math.round(crop.x * videoW) : 0;
  const cropPxY = videoH ? Math.round(crop.y * videoH) : 0;
  const cropPxW = videoW ? Math.round(crop.width * videoW) : 0;
  const cropPxH = videoH ? Math.round(crop.height * videoH) : 0;

  function updateCropFromPixels(p: { x?: number; y?: number; w?: number; h?: number }) {
    if (!videoW || !videoH) return;
    if (!isFinite(p.x ?? 0) || !isFinite(p.y ?? 0) || !isFinite(p.w ?? 0) || !isFinite(p.h ?? 0)) return;
    const next = { ...crop };
    if (p.x != null) next.x = Math.max(0, Math.min(videoW - 1, p.x)) / videoW;
    if (p.y != null) next.y = Math.max(0, Math.min(videoH - 1, p.y)) / videoH;
    if (p.w != null) next.width = Math.max(1, Math.min(videoW, p.w)) / videoW;
    if (p.h != null) next.height = Math.max(1, Math.min(videoH, p.h)) / videoH;
    // Keep the rect within the frame.
    if (next.x + next.width > 1) next.x = Math.max(0, 1 - next.width);
    if (next.y + next.height > 1) next.y = Math.max(0, 1 - next.height);
    setCrop(next);
    setAspectId('free');
    setCropEnabled(true);
  }

  // Major ruler ticks (with label) and minor ticks (5 subdivisions per major).
  const rulerTicks = useMemo(() => {
    if (!videoDuration || videoDuration <= 0) {
      return { major: [] as number[], minor: [] as number[], interval: 1 };
    }
    const innerWidth = Math.max(1, scrollViewportW * timelineZoom);
    const pxPerSec = innerWidth / videoDuration;
    // Aim for a major tick roughly every 90px on screen.
    const targetSec = 90 / pxPerSec;
    const interval = pickRulerInterval(targetSec);
    const major: number[] = [];
    const minor: number[] = [];
    for (let t = 0; t <= videoDuration + 1e-3; t += interval) {
      major.push(Math.min(t, videoDuration));
    }
    const minorStep = interval / 5;
    if (minorStep > 0 && pxPerSec * minorStep > 6) {
      for (let t = minorStep; t < videoDuration - 1e-3; t += minorStep) {
        if (Math.abs(t / interval - Math.round(t / interval)) > 1e-6) {
          minor.push(t);
        }
      }
    }
    return { major, minor, interval };
  }, [videoDuration, timelineZoom, scrollViewportW]);

  function handleTimelineHover(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * videoDuration;
    setHoverPreview({ time, clientX: e.clientX, topY: rect.top });
  }

  function clearTimelineHover() {
    setHoverPreview(null);
  }

  function handleClearOtherProjects() {
    if (storageStats.othersCount === 0) return;
    const msg = (TRANSLATIONS[uiLang]['confirmClearOthers'] ?? TRANSLATIONS.en['confirmClearOthers'])
      .replace('{count}', String(storageStats.othersCount))
      .replace('{size}', formatBytes(storageStats.others));
    if (!window.confirm(msg)) return;
    clearOtherProjects(videoPath);
    setStorageStats(autosaveStats(videoPath));
  }

  return (
    <div className="app">
      <div className={'app-titlebar drag-region' + (IS_MAC ? ' is-mac' : '')}>
        <span className="app-titlebar-brand">SUBBI</span>
        <span className="app-titlebar-sep">—</span>
        <span className="app-titlebar-doc">
          {videoPath ? videoPath.split(/[\\/]/).pop() : t('untitledProject')}
        </span>
        {videoPath && (
          <span className={'app-titlebar-save' + (autosaveTick === 'saved' ? ' is-pulse' : '')}>
            {autosaveTick === 'saved' ? '● Saved' : '○ Auto'}
          </span>
        )}
        <span
          className="app-titlebar-storage"
          title={
            t('storageTooltip')
              .replace('{total}', formatBytes(storageStats.total))
              .replace('{count}', String(storageStats.count))
              .replace('{others}', formatBytes(storageStats.others))
              .replace('{othersCount}', String(storageStats.othersCount))
          }
        >
          {t('storageLabel').replace('{size}', formatBytes(storageStats.total))}
        </span>
        <button
          type="button"
          className="app-titlebar-open no-drag"
          onClick={pickFile}
          disabled={isBusy}
          title={t('openVideo')}
        >
          {t('openVideo')}
        </button>
        <button
          type="button"
          className="app-titlebar-clear no-drag"
          onClick={handleClearOtherProjects}
          disabled={storageStats.othersCount === 0}
          title={
            storageStats.othersCount === 0
              ? t('clearOthersNone')
              : t('clearOthersTitle')
                  .replace('{count}', String(storageStats.othersCount))
                  .replace('{size}', formatBytes(storageStats.others))
          }
        >
          {t('clearOthers')}
          {storageStats.othersCount > 0 && (
            <span className="app-titlebar-clear-badge">
              {formatBytes(storageStats.others)}
            </span>
          )}
        </button>
        <button
          type="button"
          className="app-titlebar-theme no-drag"
          onClick={cycleTheme}
          title={
            themePref === 'system' ? t('themeSystem')
              : themePref === 'light' ? t('themeLight')
              : t('themeDark')
          }
          aria-label={
            themePref === 'system' ? t('themeSystem')
              : themePref === 'light' ? t('themeLight')
              : t('themeDark')
          }
        >
          {themePref === 'system' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="13" rx="1" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          ) : themePref === 'light' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="app-titlebar-lang no-drag">
          <Select
            size="sm"
            value={uiLang}
            onChange={v => setUiLang(v as UiLang)}
            options={[{ value: 'en', label: 'EN' }, { value: 'es', label: 'ES' }]}
          />
        </div>
      </div>
      <div className="app-body">
      <div className={'preview' + (!videoUrl ? ' drag-region' : '')}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }}
           onDragLeave={() => setOver(false)}
           onDrop={onDrop}>
        {!videoUrl && (
          <label className={'dropzone' + (over ? ' over' : '')} onClick={pickFile}>
            <div style={{ fontSize: 42, marginBottom: 12, lineHeight: 1 }}>{over ? '⬇' : '🎬'}</div>
            <div style={{ fontSize: 18, marginBottom: 12 }}>{over ? t('dropNow') : t('dropHere')}</div>
            <span className="dropzone-cta">{t('openVideo')}</span>
          </label>
        )}
        {videoUrl && (
          <div className="preview-toolbar">
            <button className="vc-btn" onClick={zoomOut} title="Zoom out (Ctrl −)" disabled={previewZoom <= ZOOM_MIN}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2"/></svg>
            </button>
            <button className="vc-zoom-label" onClick={zoomFit} title="Fit (Ctrl 0)">
              {Math.round(previewZoom * 100)}%
            </button>
            <button className="vc-btn" onClick={zoomIn} title="Zoom in (Ctrl +)" disabled={previewZoom >= ZOOM_MAX}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2"/><rect x="11" y="5" width="2" height="14"/></svg>
            </button>
            <button className="pr-btn pr-btn-ghost vc-fit-btn" onClick={zoomFit} title="Fit (Ctrl 0)">Fit</button>
            <button className="pr-btn pr-btn-ghost vc-fit-btn" onClick={zoomActual} title="Actual pixels (100%)">1:1</button>
            <span className="vc-spacer" />
            <button
              data-reset-key="all"
              className={'pr-btn pr-btn-ghost vc-reset-btn' + (confirmReset === 'all' ? ' is-confirming' : '')}
              onClick={() => {
                if (confirmReset === 'all') { resetAllEdits(); clearArmedReset(); }
                else armReset('all');
              }}
              disabled={isBusy}
              title={t('resetEditsTitle')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <polyline points="3 4 3 9 8 9" />
              </svg>
              <span>{confirmReset === 'all' ? t('resetConfirm') : t('resetEdits')}</span>
            </button>
            <span className="vc-toolbar-label">Speed</span>
            <Select
              className="vc-speed"
              value={String(playbackRate)}
              onChange={v => setPlaybackRate(+v)}
              title="Playback speed"
              options={[
                { value: '0.25', label: '0.25×' },
                { value: '0.5', label: '0.5×' },
                { value: '0.75', label: '0.75×' },
                { value: '1', label: '1×' },
                { value: '1.25', label: '1.25×' },
                { value: '1.5', label: '1.5×' },
                { value: '2', label: '2×' },
              ]}
            />
          </div>
        )}
        {videoUrl && (
          <div className="video-stage">
            <div
              className={'video-wrap' + (previewZoom !== 1 ? ' is-zoomed' : '')}
              style={previewZoom !== 1 ? {
                width: `${(videoRef.current?.videoWidth || 1280) * previewZoom}px`,
                height: `${(videoRef.current?.videoHeight || 720) * previewZoom}px`,
              } : undefined}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                onClick={togglePlay}
                onLoadedMetadata={() => bumpVideoEl(n => n + 1)}
              />
              <div
                className={
                  'subtitle-overlay'
                  + (activeCue ? '' : ' sample')
                  + (activeCue && !editingCue ? ' is-editable' : '')
                  + (editingCue ? ' is-editing' : '')
                }
                style={overlayStyle}
                onClick={(e) => {
                  if (!activeCue || editingCue) return;
                  e.stopPropagation();
                  beginEditCue();
                }}
                title={activeCue && !editingCue ? t('clickToEditCue') : undefined}
              >
                {editingCue ? (
                  <textarea
                    className="subtitle-edit"
                    value={editingText}
                    autoFocus
                    rows={Math.max(1, editingText.split('\n').length)}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitEditCue();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditCue();
                      }
                      e.stopPropagation();
                    }}
                    onBlur={commitEditCue}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontFamily: style.fontName,
                      fontSize: `${style.fontSize}px`,
                      color: style.color,
                      fontWeight: 700,
                      textAlign: 'center',
                    }}
                  />
                ) : (
                  previewText
                )}
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
            <button
              className="vc-btn vc-split-btn"
              onClick={addSplitAtCurrent}
              disabled={!videoDuration || isBusy}
              title={t('splitHere')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                <line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
            </button>
            {selectedMarker != null && (
              <button
                className="vc-btn vc-split-remove"
                onClick={removeSelectedMarker}
                disabled={isBusy}
                title={t('removeSplit')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.3 5.71L12 12.01l-6.3-6.3-1.4 1.4 6.29 6.3-6.29 6.29 1.4 1.42 6.3-6.3 6.3 6.3 1.4-1.42-6.29-6.29 6.29-6.3z"/>
                </svg>
              </button>
            )}
            {splitMarkers.length > 0 && (
              <span className="vc-split-count" title={t('exportPartsHint')}>
                {splitMarkers.length} {t('splitsBadge')}
              </span>
            )}
            <span className="vc-spacer" />
            <span className="vc-zoom-icon" title={`${t('zoomTimeline')}: ${timelineZoom.toFixed(1)}x`}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16" y2="16" />
              </svg>
            </span>
            <input
              type="range"
              className="pr-range vc-zoom"
              min={1}
              max={10}
              step={0.1}
              value={timelineZoom}
              disabled={!videoDuration}
              style={rangePct(timelineZoom, 1, 10)}
              onChange={(e) => setTimelineZoom(+e.target.value)}
              title={`${t('zoomTimeline')}: ${timelineZoom.toFixed(1)}x`}
            />
            {timelineZoom !== 1 && (
              <button
                type="button"
                className="vc-zoom-reset"
                onClick={() => setTimelineZoom(1)}
                title={t('zoomReset')}
              >×</button>
            )}
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
              style={rangePct(muted ? 0 : volume, 0, 1)}
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
          <div className="audio-strip">
            <div className="audio-strip-main">
              <div
                ref={timelineScrollRef}
                className="audio-strip-scroll"
                onMouseLeave={clearTimelineHover}
              >
                <div
                  className="audio-strip-zoomable"
                  style={{ width: `${timelineZoom * 100}%` }}
                  onMouseMove={handleTimelineHover}
                  onMouseEnter={handleTimelineHover}
                >
                  {hoverPreview && videoDuration > 0 && (
                    <div
                      className="audio-strip-hoverline"
                      style={{ left: `${(hoverPreview.time / videoDuration) * 100}%` }}
                    />
                  )}
                  {videoDuration > 0 && (
                    <div className="audio-strip-ruler">
                      {rulerTicks.minor.map((t, i) => (
                        <div
                          key={`mn-${i}`}
                          className="audio-strip-ruler-tick is-minor"
                          style={{ left: `${(t / videoDuration) * 100}%` }}
                        />
                      ))}
                      {rulerTicks.major.map((t, i) => {
                        const left = (t / videoDuration) * 100;
                        const isLast = i === rulerTicks.major.length - 1;
                        return (
                          <div
                            key={`mj-${i}`}
                            className="audio-strip-ruler-tick is-major"
                            style={{ left: `${left}%` }}
                          >
                            <span
                              className={'audio-strip-ruler-label' + (isLast ? ' is-end' : '')}
                            >
                              {fmtRulerTime(t, rulerTicks.interval)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="audio-strip-seek">
                    <input
                      type="range"
                      className="pr-range vc-seek"
                      min={0}
                      max={Math.max(0.01, videoDuration)}
                      step={0.01}
                      value={Math.min(currentTime, videoDuration || 0)}
                      style={rangePct(Math.min(currentTime, videoDuration || 0), 0, Math.max(0.01, videoDuration))}
                      onChange={(e) => seekTo(+e.target.value)}
                    />
                  </div>
                  <div className="audio-strip-timeline">
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
                      splitMarkers={splitMarkers}
                      selectedMarker={selectedMarker}
                      onSelectMarker={setSelectedMarker}
                      theme={resolvedTheme}
                    />
                  </div>
                </div>
              </div>
              {peaks === null && (
                <div className="audio-strip-hint">{t('generatingWaveform')}</div>
              )}
              {silenceRegions.length > 0 && (
                <div className="audio-strip-hint">{t('clickRegionToToggle')}</div>
              )}
            </div>
            <div className="audio-strip-faders">
              <div className="audio-fader">
                <span
                  className="audio-fader-key has-tip"
                  data-tip={`${t('audioGain')}: ${volumeDb > 0 ? '+' : ''}${volumeDb} dB`}
                >G</span>
                <input
                  type="range"
                  min={-30} max={30} step={1}
                  value={volumeDb}
                  disabled={!videoPath || isBusy}
                  onChange={e => setVolumeDb(+e.target.value)}
                  className="pr-range pr-range-v"
                  style={rangePct(volumeDb, -30, 30)}
                />
                <span className="audio-fader-num">{volumeDb > 0 ? '+' : ''}{volumeDb}</span>
              </div>
              <div className={'audio-fader' + (noiseGateEnabled ? '' : ' is-off')}>
                <button
                  type="button"
                  className={'audio-fader-key audio-fader-key-btn has-tip' + (noiseGateEnabled ? ' is-on' : '')}
                  onClick={() => setNoiseGateEnabled(v => !v)}
                  disabled={!videoPath || isBusy}
                  data-tip={`${t('audioGate')}: ${noiseGateEnabled ? `${noiseGateDb} dB` : t('audioGateOff')}`}
                >N</button>
                <input
                  type="range"
                  min={-60} max={-1} step={1}
                  value={noiseGateDb}
                  disabled={!videoPath || isBusy || !noiseGateEnabled}
                  onChange={e => setNoiseGateDb(+e.target.value)}
                  className="pr-range pr-range-v"
                  style={rangePct(noiseGateDb, -60, -1)}
                />
                <span className="audio-fader-num">
                  {noiseGateEnabled ? noiseGateDb : '–'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="pr-sidebar">

        {/* CROP */}
        <div className={'pr-section' + (openSections.crop ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('crop')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionCrop')}</span>
            {cropEnabled && <span className="pr-badge">ON</span>}
            {renderSectionReset(
              'crop',
              resetCrop,
              cropEnabled || aspectId !== 'free' || crop.x !== DEFAULT_CROP.x || crop.y !== DEFAULT_CROP.y || crop.width !== DEFAULT_CROP.width || crop.height !== DEFAULT_CROP.height
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('aspectRatio')}</span>
              <div className="pr-aspect-row">
                {ASPECT_PRESETS.map(p => (
                  <button
                    key={p.id}
                    disabled={!videoPath || isBusy}
                    onClick={() => {
                      setAspectId(p.id);
                      setCropEnabled(true);
                    }}
                    className={'pr-chip' + (cropEnabled && aspectId === p.id ? ' pr-chip-on' : '')}
                  >{p.id === 'free' ? t('aspectFree') : p.label}</button>
                ))}
              </div>
            </div>
            <div className="pr-row pr-crop-px-row">
              <span className="pr-label">{t('cropPixels')}</span>
              <div className="pr-crop-px-grid">
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropX')}</span>
                  <input
                    type="number" min={0} step={1}
                    value={cropPxX}
                    disabled={!videoPath || !videoW || isBusy}
                    onChange={(e) => updateCropFromPixels({ x: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropY')}</span>
                  <input
                    type="number" min={0} step={1}
                    value={cropPxY}
                    disabled={!videoPath || !videoH || isBusy}
                    onChange={(e) => updateCropFromPixels({ y: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropW')}</span>
                  <input
                    type="number" min={1} step={1}
                    value={cropPxW}
                    disabled={!videoPath || !videoW || isBusy}
                    onChange={(e) => updateCropFromPixels({ w: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropH')}</span>
                  <input
                    type="number" min={1} step={1}
                    value={cropPxH}
                    disabled={!videoPath || !videoH || isBusy}
                    onChange={(e) => updateCropFromPixels({ h: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
              </div>
            </div>
            <div className="pr-row pr-row-end">
              <button
                onClick={() => { setCrop(DEFAULT_CROP); setAspectId('free'); setCropEnabled(true); }}
                disabled={!videoPath || isBusy}
                className="pr-btn pr-btn-ghost">
                {t('resetCrop')}
              </button>
              <button
                onClick={() => setCropEnabled(false)}
                disabled={!cropEnabled || isBusy}
                className="pr-btn pr-btn-ghost">
                {t('disableCrop')}
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
            {renderSectionReset(
              'silence',
              resetSilence,
              silenceRegions.length > 0 || thresholdDb !== -30 || !autoThreshold || Math.abs(minSilenceDur - 0.5) > 1e-6
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('threshold')}</span>
              <input type="range" min={-60} max={-10} step={1} value={thresholdDb}
                     disabled={isBusy || autoThreshold}
                     onChange={e => setThresholdDb(+e.target.value)}
                     style={rangePct(thresholdDb, -60, -10)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{thresholdDb} dB</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('minDuration')}</span>
              <input type="range" min={0.1} max={2} step={0.05} value={minSilenceDur}
                     disabled={isBusy}
                     onChange={e => setMinSilenceDur(+e.target.value)}
                     style={rangePct(minSilenceDur, 0.1, 2)}
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
            {renderSectionReset(
              'audio',
              resetAudio,
              Math.abs(volumeDb) > 0.01 || noiseGateEnabled || noiseGateDb !== -40
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('audioGain')}</span>
              <input type="range" min={-30} max={30} step={1} value={volumeDb}
                     disabled={!videoPath || isBusy}
                     onChange={e => setVolumeDb(+e.target.value)}
                     style={rangePct(volumeDb, -30, 30)}
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

            <div className="pr-row" style={{ marginTop: 8 }}>
              <label className="pr-check">
                <input type="checkbox"
                       checked={noiseGateEnabled}
                       disabled={!videoPath || isBusy}
                       onChange={e => setNoiseGateEnabled(e.target.checked)} />
                <span>{t('audioGate')}</span>
              </label>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('threshold')}</span>
              <input type="range" min={-60} max={-1} step={1} value={noiseGateDb}
                     disabled={!videoPath || isBusy || !noiseGateEnabled}
                     onChange={e => setNoiseGateDb(+e.target.value)}
                     style={rangePct(noiseGateDb, -60, -1)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">
                {noiseGateEnabled ? `${noiseGateDb} dB` : t('audioGateOff')}
              </span>
            </div>
            <div className="pr-hint">{t('audioGateHint')}</div>
          </div>
        </div>

        {/* TRANSCRIPTION */}
        <div className={'pr-section' + (openSections.transcription ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('transcription')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionTranscription')}</span>
            {cues && <span className="pr-badge">{cues.length} {t('cues')}</span>}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('language')}</span>
              <Select
                className="pr-input-flex"
                value={language}
                onChange={setLanguage}
                disabled={isBusy}
                options={[
                  { value: 'es', label: t('langSpanish') },
                  { value: 'en', label: t('langEnglish') },
                  { value: 'pt', label: t('langPortuguese') },
                  { value: 'auto', label: t('langAuto') },
                ]}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('model')}</span>
              <Select
                className="pr-input-flex"
                value={model}
                onChange={v => setModel(v as any)}
                disabled={isBusy}
                options={[
                  { value: 'tiny', label: t('modelTiny') },
                  { value: 'medium', label: t('modelMedium') },
                  { value: 'large', label: t('modelLarge') },
                ]}
              />
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
            <span className="pr-section-title">{t('sectionSubtitleStyle')}</span>
            {renderSectionReset(
              'style',
              resetStyle,
              (Object.keys(DEFAULT_STYLE) as (keyof SubtitleStyle)[]).some(k => (style as any)[k] !== (DEFAULT_STYLE as any)[k])
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('font')}</span>
              <Select
                className="pr-input-flex"
                value={style.fontName}
                onChange={v => setStyle(s => ({ ...s, fontName: v }))}
                options={FONT_OPTIONS.map(f => ({ value: f, label: f }))}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('size')}</span>
              <input type="range" min={12} max={80} value={style.fontSize}
                     onChange={e => setStyle(s => ({ ...s, fontSize: +e.target.value }))}
                     style={rangePct(style.fontSize, 12, 80)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.fontSize}px</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('vertical')}</span>
              <input type="range" min={0} max={45} value={style.marginVPct}
                     onChange={e => setStyle(s => ({ ...s, marginVPct: +e.target.value }))}
                     style={rangePct(style.marginVPct, 0, 45)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.marginVPct}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('horizontal')}</span>
              <input type="range" min={-40} max={40} value={style.marginHPct}
                     onChange={e => setStyle(s => ({ ...s, marginHPct: +e.target.value }))}
                     style={rangePct(style.marginHPct, -40, 40)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{style.marginHPct > 0 ? '+' : ''}{style.marginHPct}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('color')}</span>
              <ColorPicker value={style.color}
                           onChange={v => setStyle(s => ({ ...s, color: v }))} />
              <label className="pr-check pr-label-mid" title={t('outline')}>
                <input type="checkbox"
                       checked={style.outlineEnabled}
                       onChange={e => setStyle(s => ({ ...s, outlineEnabled: e.target.checked }))} />
                <span>{t('outline')}</span>
              </label>
              <ColorPicker value={style.outline}
                           disabled={!style.outlineEnabled}
                           onChange={v => setStyle(s => ({ ...s, outline: v }))} />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('textCase')}</span>
              <Select
                className="pr-input-flex"
                value={style.textCase}
                onChange={v => setStyle(s => ({ ...s, textCase: v as any }))}
                options={[
                  { value: 'asis', label: t('caseAsIs') },
                  { value: 'upper', label: t('caseUpper') },
                  { value: 'lower', label: t('caseLower') },
                ]}
              />
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
            <span className={'pr-pill' + (cropEnabled ? ' on' : '')}>{t('pillCrop')}</span>
            <span className={'pr-pill' + (enabledCount > 0 ? ' on' : '')}>{t('pillSilence')} {enabledCount > 0 ? enabledCount : ''}</span>
            <span className={'pr-pill' + (Math.abs(volumeDb) > 0.01 ? ' on' : '')}>{t('pillAudio')} {Math.abs(volumeDb) > 0.01 ? `${volumeDb > 0 ? '+' : ''}${volumeDb}dB` : ''}</span>
            <span className={'pr-pill' + (cues && cues.length > 0 ? ' on' : '')}>{t('pillSubs')} {cues && cues.length > 0 ? cues.length : ''}</span>
            {splitMarkers.length > 0 && (
              <span className="pr-pill on" title={t('exportPartsHint')}>
                {splitMarkers.length + 1} {t('splitsBadge').toUpperCase()}
              </span>
            )}
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

      {/* Hover preview: hidden video stays mounted so seeking is instant. */}
      <div
        className={'timeline-preview' + (hoverPreview && videoUrl ? ' is-on' : '')}
        style={
          hoverPreview
            ? {
                left: hoverPreview.clientX,
                top: hoverPreview.topY,
              }
            : undefined
        }
      >
        <div className="timeline-preview-frame">
          <video
            ref={previewVideoRef}
            className="timeline-preview-video"
            muted
            playsInline
            preload="auto"
          />
        </div>
        <div className="timeline-preview-time">
          {hoverPreview ? fmtTime(hoverPreview.time) : ''}
        </div>
      </div>
    </div>
  );
}
