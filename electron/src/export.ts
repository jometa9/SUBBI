import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';
import { findRnnoiseModel } from './rnnoise';

export type VoiceCleanupIntensity = 'light' | 'medium' | 'strong';

export function voiceCleanupSpawnCwd(): string | undefined {
  const modelPath = findRnnoiseModel();
  return modelPath ? path.dirname(modelPath) : undefined;
}

export function buildVoiceCleanupChain(intensity: VoiceCleanupIntensity): string {
  const modelPath = findRnnoiseModel();
  const arnndn = modelPath ? `arnndn=m=${path.basename(modelPath)},` : '';
  if (intensity === 'light') {
    return `highpass=f=80,${arnndn}afftdn=nf=-25:nr=10,acompressor=threshold=-22dB:ratio=2:attack=10:release=200:makeup=2`;
  }
  if (intensity === 'strong') {
    return `highpass=f=100,${arnndn}${arnndn}afftdn=nf=-25:nr=28,acompressor=threshold=-18dB:ratio=4:attack=5:release=150:makeup=4,loudnorm=I=-14:TP=-1.5:LRA=11`;
  }
  return `highpass=f=85,${arnndn}afftdn=nf=-25:nr=18,acompressor=threshold=-20dB:ratio=3:attack=8:release=200:makeup=3,loudnorm=I=-16:TP=-1.5:LRA=11`;
}

let currentExportChild: ChildProcess | null = null;
let cancelRequested = false;

export function cancelExport(): boolean {
  cancelRequested = true;
  const child = currentExportChild;
  if (child && !child.killed) {
    try { child.kill('SIGKILL'); } catch {}
    return true;
  }
  return false;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  fontWeight?: 'normal' | 'semibold' | 'bold';
  color: string;
  outline: string;
  outlineEnabled?: boolean;
  outlineWidth?: number;
  marginVPct: number;
  marginHPct: number;
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
}

export interface KeepRange { start: number; end: number; }

export interface CropNormalized {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportOptions {
  videoPath: string;
  keepRanges?: KeepRange[];
  crop?: CropNormalized | null;
  cropBgColor?: 'black' | 'white';
  subtitles?: { srtPath: string; style: SubtitleStyle } | null;
  volumeDb?: number;
  noiseGateDb?: number | null;
  voiceCleanup?: { enabled: boolean; intensity: VoiceCleanupIntensity } | null;
  saturation?: number;
  opacity?: number;
  opacityBgColor?: 'black' | 'white';
  speed?: number;
  muteOriginal?: boolean;
  outputPath?: string;
  videoWidth?: number;
  videoHeight?: number;
  bgAudio?: BgAudioMix | null;
}

export interface BgAudioMix {
  path: string;
  offset: number;
  inPoint: number;
  outPoint: number;
  volumeDb: number;
}

type Cue = { start: number; end: number; text: string };

function hexToAssColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '&H00FFFFFF';
  const r = m[1].slice(0, 2);
  const g = m[1].slice(2, 4);
  const b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
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
    const toSec = (m: RegExpMatchArray) =>
      (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    out.push({
      start: toSec(matches[0]),
      end: toSec(matches[1]),
      text: lines.slice(lines.indexOf(tline) + 1).join('\n').trim(),
    });
  }
  return out;
}

function fmtTs(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function formatSrt(cues: Cue[]): string {
  return cues.map((c, i) =>
    `${i + 1}\n${fmtTs(c.start)} --> ${fmtTs(c.end)}\n${c.text}\n`
  ).join('\n');
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

function fmtAssTs(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function escAssText(text: string): string {
  return text.replace(/\r\n/g, '\\N').replace(/\n/g, '\\N').replace(/,/g, '‚');
}

function buildAssFromSrt(srtPath: string, style: SubtitleStyle, videoW: number, videoH: number): string {
  const raw = fs.readFileSync(srtPath, 'utf8');
  let cues = parseSrt(raw);
  if (style.maxWords && style.maxWords > 0) cues = resegmentByWords(cues, style.maxWords);
  if (style.textCase !== 'asis') {
    cues = cues.map(c => ({
      ...c,
      text: style.textCase === 'upper' ? c.text.toLocaleUpperCase() : c.text.toLocaleLowerCase(),
    }));
  }
  const marginV = Math.max(0, Math.round(videoH * (style.marginVPct / 100)));
  const hShift = Math.round(videoW * ((style.marginHPct || 0) / 100));
  const marginL = Math.max(0, 2 * hShift);
  const marginR = Math.max(0, -2 * hShift);
  const outlineOn = style.outlineEnabled !== false;
  const bold = style.fontWeight === 'normal' ? 0 : -1;
  const primary = hexToAssColor(style.color);
  const outlineCol = hexToAssColor(style.outline);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${videoW}`,
    `PlayResY: ${videoH}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontName},${style.fontSize},${primary},${primary},${outlineCol},&H00000000,${bold},0,0,0,100,100,0,0,1,${outlineOn ? Math.max(0, style.outlineWidth ?? 2) : 0},0,2,${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map(c =>
    `Dialogue: 0,${fmtAssTs(c.start)},${fmtAssTs(c.end)},Default,,0,0,0,,${escAssText(c.text)}`
  );
  const content = [...header, ...events, ''].join('\n');
  const out = path.join(os.tmpdir(), 'subbi', `${randomUUID()}.ass`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, 'utf8');
  return out;
}

function escapeForFilter(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function systemFontsDir(): string | null {
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
    return path.join(winDir, 'Fonts');
  }
  if (process.platform === 'darwin') {
    return '/Library/Fonts';
  }
  return '/usr/share/fonts';
}

function buildSubtitlesFilter(assPath: string): string {
  const fontsDir = systemFontsDir();
  const fontsPart = fontsDir && fs.existsSync(fontsDir)
    ? `:fontsdir='${escapeForFilter(fontsDir)}'`
    : '';
  return `ass='${escapeForFilter(assPath)}'${fontsPart}`;
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

function computeCropOutputSize(c: CropNormalized, videoW: number, videoH: number): { w: number; h: number } {
  const innerX = clamp01(c.x);
  const innerY = clamp01(c.y);
  const innerW = clamp01(c.x + c.width) - innerX;
  const innerH = clamp01(c.y + c.height) - innerY;
  const extendsOutside =
    c.x < -1e-6 || c.y < -1e-6 || c.x + c.width > 1 + 1e-6 || c.y + c.height > 1 + 1e-6;
  const evenFloor = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const evenCeil = (v: number) => Math.max(2, Math.ceil(v / 2) * 2);
  if (!extendsOutside) {
    return { w: evenFloor(videoW * innerW), h: evenFloor(videoH * innerH) };
  }
  return { w: evenCeil(videoW * c.width), h: evenCeil(videoH * c.height) };
}

function buildAtempoChain(speed: number): string {
  let s = speed;
  const parts: string[] = [];
  while (s < 0.5 - 1e-6) { parts.push('atempo=0.5'); s = s / 0.5; }
  while (s > 100 + 1e-6) { parts.push('atempo=100'); s = s / 100; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

function buildCropFilter(c: CropNormalized, bgColor: 'black' | 'white' = 'black'): string {
  const innerX = clamp01(c.x);
  const innerY = clamp01(c.y);
  const innerW = clamp01(c.x + c.width) - innerX;
  const innerH = clamp01(c.y + c.height) - innerY;
  const extendsOutside =
    c.x < -1e-6 || c.y < -1e-6 || c.x + c.width > 1 + 1e-6 || c.y + c.height > 1 + 1e-6;
  const cropPart = `crop='trunc(iw*${innerW}/2)*2':'trunc(ih*${innerH}/2)*2':'trunc(iw*${innerX}/2)*2':'trunc(ih*${innerY}/2)*2'`;
  if (!extendsOutside) return cropPart;
  const wFactor = c.width / Math.max(1e-6, innerW);
  const hFactor = c.height / Math.max(1e-6, innerH);
  const xFactor = (innerX - c.x) / Math.max(1e-6, innerW);
  const yFactor = (innerY - c.y) / Math.max(1e-6, innerH);
  const padPart = `pad='2*ceil(iw*${wFactor}/2)':'2*ceil(ih*${hFactor}/2)':'trunc(iw*${xFactor}/2)*2':'trunc(ih*${yFactor}/2)*2':color=${bgColor}`;
  return `${cropPart},${padPart}`;
}

export async function exportVideo(
  opts: ExportOptions,
  onProgress: (pct: number, line: string) => void
): Promise<string> {
  const ffmpeg = findFfmpeg();

  const ext = path.extname(opts.videoPath) || '.mp4';
  const base = path.basename(opts.videoPath, ext);
  const defaultOut = path.join(path.dirname(opts.videoPath), `${base}.subbi${ext}`);
  let outPath = opts.outputPath ?? defaultOut;
  if (fs.existsSync(outPath)) {
    try {
      fs.unlinkSync(outPath);
    } catch (err: any) {
      if (err?.code !== 'EBUSY' && err?.code !== 'EPERM') throw err;
      const dir = path.dirname(outPath);
      const outBase = path.basename(outPath, ext);
      let found = false;
      for (let i = 2; i < 1000; i++) {
        const candidate = path.join(dir, `${outBase}.${i}${ext}`);
        if (!fs.existsSync(candidate)) { outPath = candidate; found = true; break; }
        try { fs.unlinkSync(candidate); outPath = candidate; found = true; break; } catch {}
      }
      if (!found) throw err;
    }
  }

  const ranges = (opts.keepRanges || [])
    .map(r => ({ start: Math.max(0, r.start), end: r.end }))
    .filter(r => r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);
  const willCut = ranges.length > 0;

  const baseVideoW = opts.videoWidth && opts.videoWidth > 0 ? opts.videoWidth : 1280;
  const baseVideoH = opts.videoHeight && opts.videoHeight > 0 ? opts.videoHeight : 720;
  const outSize = opts.crop
    ? computeCropOutputSize(opts.crop, baseVideoW, baseVideoH)
    : { w: baseVideoW, h: baseVideoH };
  const assPath = opts.subtitles
    ? buildAssFromSrt(opts.subtitles.srtPath, opts.subtitles.style, outSize.w, outSize.h)
    : null;

  const filterParts: string[] = [];
  let videoSourceLabel = '[0:v]';
  const satRaw = typeof opts.saturation === 'number' && isFinite(opts.saturation) ? opts.saturation : 100;
  const wantsSaturation = Math.abs(satRaw - 100) > 0.5;
  const opRaw = typeof opts.opacity === 'number' && isFinite(opts.opacity) ? opts.opacity : 100;
  const wantsOpacity = opRaw < 99.5;
  const linearV: string[] = [];
  if (opts.crop) linearV.push(buildCropFilter(opts.crop, opts.cropBgColor || 'black'));
  if (wantsSaturation) {
    const sat = Math.max(0, Math.min(3, satRaw / 100));
    linearV.push(`eq=saturation=${sat.toFixed(3)}`);
  }
  if (linearV.length > 0) {
    filterParts.push(`${videoSourceLabel}${linearV.join(',')}[vpre]`);
    videoSourceLabel = '[vpre]';
  }
  if (wantsOpacity) {
    const alpha = Math.max(0, Math.min(1, opRaw / 100));
    const a = alpha.toFixed(4);
    const bgVal = opts.opacityBgColor === 'white' ? 255 : 0;
    const expr = bgVal === 0
      ? `val*${a}`
      : `val*${a}+${bgVal}*(1-${a})`;
    filterParts.push(
      `${videoSourceLabel}format=gbrp,lutrgb=r='${expr}':g='${expr}':b='${expr}',format=yuv420p,setsar=1[vop]`
    );
    videoSourceLabel = '[vop]';
  }
  if (assPath) {
    filterParts.push(`${videoSourceLabel}${buildSubtitlesFilter(assPath)}[vsubs]`);
    videoSourceLabel = '[vsubs]';
  }
  if (videoSourceLabel !== '[0:v]') {
    filterParts.push(
      `${videoSourceLabel}scale=flags=bicubic:in_range=auto:out_range=tv,format=yuv420p[vnorm]`
    );
    videoSourceLabel = '[vnorm]';
  }
  const videoModified = videoSourceLabel !== '[0:v]';

  let mapV: string;
  let mapA: string;
  let progressDuration: number | null = null;

  const volumeDb = typeof opts.volumeDb === 'number' && isFinite(opts.volumeDb) ? opts.volumeDb : 0;
  const wantsVolume = Math.abs(volumeDb) > 0.01;
  const gateDb = typeof opts.noiseGateDb === 'number' && isFinite(opts.noiseGateDb) ? opts.noiseGateDb : null;
  const wantsGate = gateDb != null && gateDb < -0.01 && gateDb > -90;
  const wantsMuteOriginal = !!opts.muteOriginal;
  let audioSourceLabel = '[0:a]';
  if (wantsMuteOriginal) {
    filterParts.push(`${audioSourceLabel}volume=0[amute]`);
    audioSourceLabel = '[amute]';
  }
  if (wantsVolume) {
    filterParts.push(`${audioSourceLabel}volume=${volumeDb.toFixed(2)}dB[avol]`);
    audioSourceLabel = '[avol]';
  }
  if (wantsGate) {
    const nf = Math.min(-20, Math.max(-80, gateDb!));
    filterParts.push(
      `${audioSourceLabel}afftdn=nf=${nf.toFixed(1)}:nr=12[agate]`
    );
    audioSourceLabel = '[agate]';
  }
  const vc = opts.voiceCleanup;
  const wantsVoiceCleanup = !!(vc && vc.enabled);
  if (wantsVoiceCleanup) {
    const chain = buildVoiceCleanupChain(vc!.intensity || 'medium');
    filterParts.push(`${audioSourceLabel}${chain}[avc]`);
    audioSourceLabel = '[avc]';
  }
  const wantsAudioFx = wantsMuteOriginal || wantsVolume || wantsGate || wantsVoiceCleanup;

  if (willCut) {
    const n = ranges.length;
    const vSplitOuts = Array.from({ length: n }, (_, i) => `[vsplit${i}]`).join('');
    const aSplitOuts = Array.from({ length: n }, (_, i) => `[asplit${i}]`).join('');
    filterParts.push(`${videoSourceLabel}split=${n}${vSplitOuts}`);
    filterParts.push(`${audioSourceLabel}asplit=${n}${aSplitOuts}`);
    const concatLabels: string[] = [];
    ranges.forEach((r, i) => {
      filterParts.push(
        `[vsplit${i}]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
      );
      filterParts.push(
        `[asplit${i}]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
      );
      concatLabels.push(`[v${i}][a${i}]`);
    });
    filterParts.push(`${concatLabels.join('')}concat=n=${n}:v=1:a=1[outv][outa]`);
    mapV = '[outv]';
    mapA = '[outa]';
    progressDuration = ranges.reduce((s, r) => s + (r.end - r.start), 0);
  } else if (videoModified) {
    mapV = videoSourceLabel;
    mapA = wantsAudioFx ? audioSourceLabel : '0:a?';
  } else if (wantsAudioFx) {
    mapV = '0:v';
    mapA = audioSourceLabel;
  } else {
    mapV = '0:v';
    mapA = '0:a?';
  }

  const speedRaw = typeof opts.speed === 'number' && isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1;
  const wantsSpeed = Math.abs(speedRaw - 1) > 1e-3;
  if (wantsSpeed) {
    const vIn = mapV.startsWith('[') ? mapV : `[${mapV}]`;
    const aIn = mapA.startsWith('[') ? mapA : '[0:a]';
    filterParts.push(`${vIn}setpts=PTS/${speedRaw.toFixed(6)}[vspd]`);
    filterParts.push(`${aIn}${buildAtempoChain(speedRaw)}[aspd]`);
    mapV = '[vspd]';
    mapA = '[aspd]';
  }

  const bg = opts.bgAudio;
  const wantsBg = !!bg && bg.outPoint - bg.inPoint > 0.02;
  if (wantsBg) {
    const inPoint = Math.max(0, bg!.inPoint);
    const outPoint = Math.max(inPoint + 0.02, bg!.outPoint);
    const offsetMs = Math.max(0, Math.round(bg!.offset * 1000));
    const bgVolDb = typeof bg!.volumeDb === 'number' && isFinite(bg!.volumeDb) ? bg!.volumeDb : 0;
    filterParts.push(
      `[1:a]atrim=start=${inPoint.toFixed(3)}:end=${outPoint.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${offsetMs}|${offsetMs},volume=${bgVolDb.toFixed(2)}dB[bgmix]`
    );
    const aIn = mapA.startsWith('[') ? mapA : `[${mapA.replace('?', '')}]`;
    if (!mapA.startsWith('[')) {
      filterParts.push(`[0:a]anull[amain]`);
      filterParts.push(`[amain][bgmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
    } else {
      filterParts.push(`${aIn}[bgmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
    }
    mapA = '[aout]';
  }

  const args: string[] = ['-y', '-hide_banner', '-stats', '-i', opts.videoPath];
  if (wantsBg) args.push('-i', bg!.path);
  let filterScriptPath: string | null = null;
  if (filterParts.length > 0) {
    const filterGraph = filterParts.join(';');
    if (filterGraph.length > 6000) {
      filterScriptPath = path.join(os.tmpdir(), 'subbi', `${randomUUID()}.filter.txt`);
      fs.mkdirSync(path.dirname(filterScriptPath), { recursive: true });
      fs.writeFileSync(filterScriptPath, filterGraph, 'utf8');
      args.push('-/filter_complex', filterScriptPath);
    } else {
      args.push('-filter_complex', filterGraph);
    }
  }
  args.push('-map', mapV, '-map', mapA);
  if (filterParts.length > 0) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20');
    args.push('-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1');
    args.push('-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
    args.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-c', 'copy');
  }
  args.push('-movflags', '+faststart', outPath);

  let totalSec: number | null = null;
  onProgress(0, 'evt:export.starting');

  if (cancelRequested) {
    cancelRequested = false;
    throw new Error('evt:export.cancelled');
  }

  const spawnCwd = wantsVoiceCleanup ? voiceCleanupSpawnCwd() : undefined;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, args, spawnCwd ? { cwd: spawnCwd } : undefined);
    currentExportChild = child;
    let err = '';
    let lastMilestone = -1;
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (totalSec == null) totalSec = parseDurationFromStderr(err);
      const rawDen = progressDuration ?? totalSec;
      const den = rawDen != null ? rawDen / speedRaw : null;
      for (const line of s.split(/\r|\n/)) {
        if (!line.trim()) continue;
        const t = parseTimeFromStderr(line);
        if (t != null && den) {
          const pct = Math.min(100, (t / den) * 100);
          const milestone = Math.floor(pct / 10) * 10;
          if (milestone > lastMilestone && milestone > 0 && milestone < 100) {
            lastMilestone = milestone;
            onProgress(pct, `evt:export.progress:${milestone}`);
          } else {
            onProgress(pct, '');
          }
        }
      }
    });
    child.on('error', (e) => {
      currentExportChild = null;
      reject(e);
    });
    child.on('close', (code, signal) => {
      currentExportChild = null;
      if (assPath) {
        try { fs.unlinkSync(assPath); } catch {}
      }
      if (filterScriptPath) {
        try { fs.unlinkSync(filterScriptPath); } catch {}
      }
      if (cancelRequested) {
        cancelRequested = false;
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        reject(new Error('evt:export.cancelled'));
        return;
      }
      if (code === 0) {
        onProgress(100, 'evt:export.done');
        resolve(outPath);
      } else if (signal) {
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        reject(new Error('evt:export.cancelled'));
      } else {
        console.error('[export] ffmpeg failed code=' + code);
        console.error('[export] args:', args.join(' '));
        console.error('[export] stderr tail:\n' + err.slice(-4000));
        reject(new Error('evt:err.export'));
      }
    });
  });
}

let currentPreviewChild: ChildProcess | null = null;
let previewCancelRequested = false;

export function cancelVoiceCleanupPreview(): boolean {
  previewCancelRequested = true;
  const child = currentPreviewChild;
  if (child && !child.killed) {
    try { child.kill('SIGKILL'); } catch {}
    return true;
  }
  return false;
}

export async function renderVoiceCleanupPreview(
  opts: { videoPath: string; intensity: VoiceCleanupIntensity },
  onProgress: (pct: number, line: string) => void
): Promise<string> {
  const ffmpeg = findFfmpeg();
  const chain = buildVoiceCleanupChain(opts.intensity);
  const tmpDir = path.join(os.tmpdir(), 'subbi');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = path.extname(opts.videoPath) || '.mp4';
  const outPath = path.join(tmpDir, `vc-preview-${randomUUID()}${ext}`);

  const args = [
    '-y', '-hide_banner', '-stats',
    '-i', opts.videoPath,
    '-map', '0:v', '-map', '0:a?',
    '-c:v', 'copy',
    '-filter:a', chain,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath,
  ];

  let totalSec: number | null = null;
  onProgress(0, '');
  previewCancelRequested = false;

  const spawnCwd = voiceCleanupSpawnCwd();
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, args, spawnCwd ? { cwd: spawnCwd } : undefined);
    currentPreviewChild = child;
    let err = '';
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (totalSec == null) totalSec = parseDurationFromStderr(err);
      for (const line of s.split(/\r|\n/)) {
        if (!line.trim()) continue;
        const t = parseTimeFromStderr(line);
        if (t != null && totalSec) {
          onProgress(Math.min(100, (t / totalSec) * 100), '');
        }
      }
    });
    child.on('error', (e) => { currentPreviewChild = null; reject(e); });
    child.on('close', (code, signal) => {
      currentPreviewChild = null;
      if (previewCancelRequested) {
        previewCancelRequested = false;
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        reject(new Error('evt:export.cancelled'));
        return;
      }
      if (code === 0) {
        onProgress(100, '');
        resolve(outPath);
      } else if (signal) {
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        reject(new Error('evt:export.cancelled'));
      } else {
        console.error('[vc-preview] ffmpeg failed code=' + code);
        console.error('[vc-preview] stderr tail:\n' + err.slice(-2000));
        reject(new Error('evt:err.export'));
      }
    });
  });
}
