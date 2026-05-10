import React, { useEffect, useMemo, useRef, useState } from 'react';

type Cue = { start: number; end: number; text: string };

type SubtitleStyle = {
  fontName: string;
  fontSize: number;
  color: string;        // #RRGGBB
  outline: string;      // #RRGGBB
  marginVPct: number;   // 0..45 (% from bottom)
  marginHPct: number;   // -40..40 (% horizontal shift, 0 = centered)
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
};

type ProcessState =
  | { phase: 'idle' }
  | { phase: 'transcribing'; pct: number; log: string }
  | { phase: 'ready'; srtPath: string; cues: Cue[] }
  | { phase: 'burning'; pct: number; log: string }
  | { phase: 'burned'; outPath: string }
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
    langSpanish: 'Spanish',
    langEnglish: 'English',
    langPortuguese: 'Portuguese',
    langAuto: 'Auto',
    model: 'Model',
    modelTiny: 'Tiny (fast)',
    modelMedium: 'Medium',
    modelLarge: 'Large (accurate)',
    transcribe: 'Transcribe',
    transcribing: 'Transcribing',
    subtitleStyle: 'Subtitle style',
    font: 'Font',
    size: 'Size',
    vertical: 'Vertical',
    horizontal: 'Horizontal',
    color: 'Color',
    outline: 'Outline',
    textCase: 'Case',
    caseAsIs: 'As is',
    caseUpper: 'UPPERCASE',
    caseLower: 'lowercase',
    maxPerLine: 'Max words',
    export: 'Export',
    burn: 'Burn subtitles into video',
    burning: 'Burning',
    srtGenerated: 'SRT generated',
    done: 'Done',
    burnOk: 'Ready! Enjoy your video',
    couldNotReadPath: 'Could not read file path. Try "Open video".',
  },
  es: {
    openVideo: 'Abrir video',
    dropHere: 'Soltá un video aquí',
    dropNow: 'Soltalo ahora',
    orClick: 'o hacé click para elegir',
    sampleSubtitle: 'Subtítulo de ejemplo',
    transcription: 'Transcripción',
    language: 'Idioma',
    langSpanish: 'Español',
    langEnglish: 'Inglés',
    langPortuguese: 'Portugués',
    langAuto: 'Auto',
    model: 'Modelo',
    modelTiny: 'Tiny (rápido)',
    modelMedium: 'Medium',
    modelLarge: 'Large (preciso)',
    transcribe: 'Transcribir',
    transcribing: 'Transcribiendo',
    subtitleStyle: 'Estilo del subtítulo',
    font: 'Fuente',
    size: 'Tamaño',
    vertical: 'Vertical',
    horizontal: 'Horizontal',
    color: 'Color',
    outline: 'Contorno',
    textCase: 'Mayúsc/minúsc',
    caseAsIs: 'Tal cual',
    caseUpper: 'MAYÚSCULAS',
    caseLower: 'minúsculas',
    maxPerLine: 'Máx palabras',
    export: 'Exportar',
    burn: 'Quemar subtítulos al video',
    burning: 'Quemando',
    srtGenerated: 'SRT generado',
    done: 'Listo',
    burnOk: '¡Listo! Disfrutá tu video',
    couldNotReadPath: 'No se pudo leer la ruta del archivo. Probá con "Abrir video".',
  },
};

function detectUiLang(): UiLang {
  const nav = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || '';
  const langs = (typeof navigator !== 'undefined' && (navigator as any).languages) || [nav];
  for (const l of langs) {
    if (typeof l === 'string' && l.toLowerCase().startsWith('es')) return 'es';
  }
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
    const start = toMs(matches[0]);
    const end = toMs(matches[1]);
    const textLines = lines.slice(lines.indexOf(tline) + 1);
    out.push({ start, end, text: textLines.join('\n').trim() });
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
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(' '));
    }
    const totalChars = chunks.reduce((s, x) => s + x.length, 0) || 1;
    const totalDur = c.end - c.start;
    let t = c.start;
    for (let i = 0; i < chunks.length; i++) {
      const dur = i === chunks.length - 1
        ? c.end - t
        : totalDur * (chunks[i].length / totalChars);
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

const STORAGE_KEY = 'subbi:settings:v1';

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
  } catch {
    return {};
  }
}

function saveSettings(s: PersistedSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
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

  useEffect(() => {
    saveSettings({ uiLang, language, model, style });
  }, [uiLang, language, model, style]);
  const t = (k: keyof typeof TRANSLATIONS['en']) => TRANSLATIONS[uiLang][k] ?? TRANSLATIONS.en[k];
  const videoRef = useRef<HTMLVideoElement>(null);
  const wasMutedRef = useRef<boolean>(false);

  const rawCues = proc.phase === 'ready' || proc.phase === 'burning' || proc.phase === 'burned'
    ? (proc as any).cues as Cue[] | undefined
    : undefined;

  const cues = useMemo(
    () => rawCues ? resegmentByWords(rawCues, style.maxWords) : undefined,
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
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [videoUrl]);

  useEffect(() => {
    const off = window.subbi.onProgress((evt) => {
      if (evt.kind === 'transcribe') {
        setProc(p => p.phase === 'transcribing'
          ? { phase: 'transcribing', pct: evt.pct, log: (p.log + evt.line + '\n').slice(-2000) }
          : p);
      } else if (evt.kind === 'burn') {
        setProc(p => p.phase === 'burning'
          ? { phase: 'burning', pct: evt.pct, log: (p.log + evt.line + '\n').slice(-2000) }
          : p);
      }
    });
    return off;
  }, []);

  function loadVideo(filePath: string) {
    setVideoPath(filePath);
    setVideoUrl('file:///' + filePath.replace(/\\/g, '/'));
    setProc({ phase: 'idle' });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const p = window.subbi.getPathForFile?.(f) || (f as any).path || '';
    if (!p) {
      setProc({ phase: 'error', message: t('couldNotReadPath') });
      return;
    }
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
      const { srtPath, srt } = await window.subbi.transcribe({
        videoPath, language, model,
      });
      setProc({ phase: 'ready', srtPath, cues: parseSrt(srt) });
    } catch (err: any) {
      setProc({ phase: 'error', message: String(err?.message || err) });
    }
  }

  async function burn() {
    if (!videoPath || !cues) return;
    const srtPath = (proc as any).srtPath as string;
    wasMutedRef.current = videoRef.current?.muted ?? false;
    setProc({ phase: 'burning', pct: 0, log: '' });
    try {
      const out = await window.subbi.burn({ videoPath, srtPath, style });
      setProc({ phase: 'burned', outPath: out });
      const newUrl = 'file:///' + out.replace(/\\/g, '/') + '?t=' + Date.now();
      setVideoUrl(newUrl);
      setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = wasMutedRef.current;
        v.currentTime = 0;
        v.play().catch(() => {});
      }, 120);
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

  const isBusy = proc.phase === 'transcribing' || proc.phase === 'burning';

  return (
    <div className="app">
      <div className={'preview' + (!videoUrl ? ' drag-region' : '')}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }}
           onDragLeave={() => setOver(false)}
           onDrop={onDrop}>
        {!videoUrl && (
          <label className={'dropzone' + (over ? ' over' : '')} onClick={pickFile}>
            <div style={{ fontSize: 42, marginBottom: 12, lineHeight: 1 }}>
              {over ? '⬇' : '🎬'}
            </div>
            <div style={{ fontSize: 18, marginBottom: 8 }}>
              {over ? t('dropNow') : t('dropHere')}
            </div>
            <div className="dropzone-hint" style={{ fontSize: 12 }}>{t('orClick')}</div>
          </label>
        )}
        {videoUrl && (
          <div className="video-wrap">
            <video ref={videoRef} src={videoUrl} controls />
            <div className={'subtitle-overlay' + (activeCue ? '' : ' sample')} style={overlayStyle}>
              {previewText}
            </div>
          </div>
        )}
      </div>

      <aside className="drag-region bg-pr-bg border-l border-pr-borderSoft p-4 overflow-y-auto flex flex-col gap-3.5 text-pr-text font-sans w-[320px]">
        <h2 className="m-0 text-[15px] font-semibold text-white tracking-tight">Subbi</h2>

        <div className="flex gap-2 items-center">
          <button
            onClick={pickFile}
            disabled={isBusy}
            className="px-3 py-1.5 text-[12px] font-medium rounded bg-pr-panel hover:bg-[#3a3a3a] text-pr-text border border-pr-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('openVideo')}
          </button>
          <select
            value={uiLang}
            onChange={e => setUiLang(e.target.value as UiLang)}
            className="ml-auto bg-pr-input border border-pr-border text-pr-text px-2 py-1 rounded text-[11px] focus:outline-none focus:border-pr-accent"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
        </div>
        {videoPath && (
          <div className="text-[12px] text-pr-muted truncate" title={videoPath}>
            {videoPath.split(/[\\/]/).pop()}
          </div>
        )}

        <h3 className="mt-1 mb-0 text-[10px] font-semibold text-pr-muted uppercase tracking-[0.08em]">{t('transcription')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('language')}</span>
            <select value={language} onChange={e => setLanguage(e.target.value)} disabled={isBusy}
              className="bg-pr-input border border-pr-border text-pr-text px-2 py-1.5 rounded text-[12px] focus:outline-none focus:border-pr-accent focus:ring-1 focus:ring-pr-accent/40 disabled:opacity-40">
              <option value="es">{t('langSpanish')}</option>
              <option value="en">{t('langEnglish')}</option>
              <option value="pt">{t('langPortuguese')}</option>
              <option value="auto">{t('langAuto')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('model')}</span>
            <select value={model} onChange={e => setModel(e.target.value as any)} disabled={isBusy}
              className="bg-pr-input border border-pr-border text-pr-text px-2 py-1.5 rounded text-[12px] focus:outline-none focus:border-pr-accent focus:ring-1 focus:ring-pr-accent/40 disabled:opacity-40">
              <option value="tiny">{t('modelTiny')}</option>
              <option value="medium">{t('modelMedium')}</option>
              <option value="large">{t('modelLarge')}</option>
            </select>
          </label>
        </div>
        <button onClick={transcribe} disabled={!videoPath || isBusy}
          className="px-3 py-2 text-[12px] font-semibold rounded bg-pr-accent hover:bg-pr-accentHover text-[#1a1a3a] border border-pr-accentDeep disabled:bg-pr-panel disabled:text-pr-muted disabled:border-pr-border disabled:cursor-not-allowed transition-colors">
          {proc.phase === 'transcribing' ? `${t('transcribing')}… ${proc.pct.toFixed(0)}%` : t('transcribe')}
        </button>

        <h3 className="mt-1 mb-0 text-[10px] font-semibold text-pr-muted uppercase tracking-[0.08em]">{t('subtitleStyle')}</h3>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-pr-muted">{t('font')}</span>
          <select value={style.fontName} onChange={e => setStyle(s => ({ ...s, fontName: e.target.value }))}
            className="bg-pr-input border border-pr-border text-pr-text px-2 py-1.5 rounded text-[12px] focus:outline-none focus:border-pr-accent focus:ring-1 focus:ring-pr-accent/40">
            {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('size')} ({style.fontSize}px)</span>
            <input type="range" min={12} max={80} value={style.fontSize}
                   onChange={e => setStyle(s => ({ ...s, fontSize: +e.target.value }))}
                   className="pr-range w-full" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('vertical')} ({style.marginVPct}%)</span>
            <input type="range" min={0} max={45} value={style.marginVPct}
                   onChange={e => setStyle(s => ({ ...s, marginVPct: +e.target.value }))}
                   className="pr-range w-full" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-pr-muted">{t('horizontal')} ({style.marginHPct > 0 ? '+' : ''}{style.marginHPct}%)</span>
          <input type="range" min={-40} max={40} value={style.marginHPct}
                 onChange={e => setStyle(s => ({ ...s, marginHPct: +e.target.value }))}
                 className="pr-range w-full" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('color')}</span>
            <input type="color" value={style.color}
                   onChange={e => setStyle(s => ({ ...s, color: e.target.value }))}
                   className="w-full h-7 bg-pr-input border border-pr-border rounded p-0.5 cursor-pointer" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('outline')}</span>
            <input type="color" value={style.outline}
                   onChange={e => setStyle(s => ({ ...s, outline: e.target.value }))}
                   className="w-full h-7 bg-pr-input border border-pr-border rounded p-0.5 cursor-pointer" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('textCase')}</span>
            <select value={style.textCase} onChange={e => setStyle(s => ({ ...s, textCase: e.target.value as any }))}
              className="bg-pr-input border border-pr-border text-pr-text px-2 py-1.5 rounded text-[12px] focus:outline-none focus:border-pr-accent focus:ring-1 focus:ring-pr-accent/40">
              <option value="asis">{t('caseAsIs')}</option>
              <option value="upper">{t('caseUpper')}</option>
              <option value="lower">{t('caseLower')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-pr-muted">{t('maxPerLine')}</span>
            <input type="number" min={1} max={12} value={style.maxWords}
                   onChange={e => setStyle(s => ({ ...s, maxWords: +e.target.value }))}
                   className="bg-pr-input border border-pr-border text-pr-text px-2 py-1.5 rounded text-[12px] focus:outline-none focus:border-pr-accent focus:ring-1 focus:ring-pr-accent/40" />
          </label>
        </div>

        <h3 className="mt-1 mb-0 text-[10px] font-semibold text-pr-muted uppercase tracking-[0.08em]">{t('export')}</h3>
        <button onClick={burn} disabled={!cues || isBusy}
          className={
            'px-3 py-2 text-[12px] font-semibold rounded border transition-colors disabled:cursor-not-allowed ' +
            (proc.phase === 'burned'
              ? 'bg-green-500 hover:bg-green-500 text-white border-green-600 disabled:bg-green-500 disabled:text-white disabled:border-green-600 disabled:opacity-100'
              : 'bg-pr-accent hover:bg-pr-accentHover text-[#1a1a3a] border-pr-accentDeep disabled:bg-pr-panel disabled:text-pr-muted disabled:border-pr-border')
          }>
          {proc.phase === 'burning'
            ? `${t('burning')}… ${proc.pct.toFixed(0)}%`
            : proc.phase === 'burned'
              ? `✓ ${t('burnOk')}`
              : t('burn')}
        </button>

        {(proc.phase === 'transcribing' || proc.phase === 'burning') && (
          <>
            <div className="h-1 bg-pr-input rounded-full overflow-hidden border border-pr-border">
              <div className="h-full bg-pr-accent transition-[width] duration-150" style={{ width: `${proc.pct}%` }} />
            </div>
            <pre className="text-[11px] text-pr-muted bg-[#141414] border border-pr-borderSoft rounded p-2 max-h-[140px] overflow-y-auto whitespace-pre-wrap font-mono m-0">{proc.log}</pre>
          </>
        )}
        {proc.phase === 'ready' && (
          <div className="text-[11px] text-pr-muted bg-[#141414] border border-pr-borderSoft rounded p-2">{t('srtGenerated')}: {proc.srtPath}</div>
        )}
        {proc.phase === 'burned' && (
          <div className="text-[11px] text-pr-muted bg-[#141414] border border-pr-borderSoft rounded p-2">{t('done')}: {proc.outPath}</div>
        )}
        {proc.phase === 'error' && (
          <div className="text-[11px] text-pr-danger bg-[#141414] border border-pr-danger/40 rounded p-2">{proc.message}</div>
        )}
      </aside>
    </div>
  );
}
