import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  color: string;
  outline: string;
  outlineEnabled?: boolean;
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
  subtitles?: { srtPath: string; style: SubtitleStyle } | null;
  volumeDb?: number;
  noiseGateDb?: number | null;
  outputPath?: string;
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

function transformSrt(srtPath: string, style: SubtitleStyle): string {
  const needsResegment = style.maxWords && style.maxWords > 0;
  const needsCase = style.textCase !== 'asis';
  if (!needsResegment && !needsCase) return srtPath;
  const raw = fs.readFileSync(srtPath, 'utf8');
  let cues = parseSrt(raw);
  if (needsResegment) cues = resegmentByWords(cues, style.maxWords);
  if (needsCase) {
    cues = cues.map(c => ({
      ...c,
      text: style.textCase === 'upper' ? c.text.toLocaleUpperCase() : c.text.toLocaleLowerCase(),
    }));
  }
  const out = path.join(os.tmpdir(), 'subbi', `${randomUUID()}.srt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, formatSrt(cues), 'utf8');
  return out;
}

function escapeForFilter(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildSubtitlesFilter(srtPath: string, style: SubtitleStyle): string {
  const marginV = Math.round(720 * (style.marginVPct / 100));
  const hShift = Math.round(1280 * ((style.marginHPct || 0) / 100));
  const marginL = Math.max(0, 2 * hShift);
  const marginR = Math.max(0, -2 * hShift);
  const outlineOn = style.outlineEnabled !== false;
  const styleParts = [
    `FontName=${style.fontName}`,
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${hexToAssColor(style.color)}`,
    `OutlineColour=${hexToAssColor(style.outline)}`,
    `BorderStyle=1`, `Outline=${outlineOn ? 2 : 0}`, `Shadow=0`,
    `Alignment=2`,
    `MarginV=${marginV}`,
    `MarginL=${marginL}`, `MarginR=${marginR}`,
    `Bold=1`,
  ].join(',');
  return `subtitles='${escapeForFilter(srtPath)}':force_style='${styleParts}'`;
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

function buildCropFilter(c: CropNormalized): string {
  const x = clamp01(c.x);
  const y = clamp01(c.y);
  const w = clamp01(c.width);
  const h = clamp01(c.height);
  return `crop='trunc(iw*${w}/2)*2':'trunc(ih*${h}/2)*2':'trunc(iw*${x}/2)*2':'trunc(ih*${y}/2)*2'`;
}

export async function exportVideo(
  opts: ExportOptions,
  onProgress: (pct: number, line: string) => void
): Promise<string> {
  const ffmpeg = findFfmpeg();

  const ext = path.extname(opts.videoPath) || '.mp4';
  const base = path.basename(opts.videoPath, ext);
  const outPath = opts.outputPath
    ?? path.join(path.dirname(opts.videoPath), `${base}.subbi${ext}`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const ranges = (opts.keepRanges || [])
    .map(r => ({ start: Math.max(0, r.start), end: r.end }))
    .filter(r => r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);
  const willCut = ranges.length > 0;

  const srtTransformed = opts.subtitles
    ? transformSrt(opts.subtitles.srtPath, opts.subtitles.style)
    : null;

  const preChain: string[] = [];
  let preLabel = '[0:v]';
  if (opts.crop) preChain.push(buildCropFilter(opts.crop));
  if (srtTransformed && opts.subtitles) preChain.push(buildSubtitlesFilter(srtTransformed, opts.subtitles.style));

  const filterParts: string[] = [];
  let videoSourceLabel: string;
  if (preChain.length > 0) {
    filterParts.push(`${preLabel}${preChain.join(',')}[vpre]`);
    videoSourceLabel = '[vpre]';
  } else {
    videoSourceLabel = '[0:v]';
  }

  let mapV: string;
  let mapA: string;
  let progressDuration: number | null = null;

  const volumeDb = typeof opts.volumeDb === 'number' && isFinite(opts.volumeDb) ? opts.volumeDb : 0;
  const wantsVolume = Math.abs(volumeDb) > 0.01;
  const gateDb = typeof opts.noiseGateDb === 'number' && isFinite(opts.noiseGateDb) ? opts.noiseGateDb : null;
  const wantsGate = gateDb != null && gateDb < -0.01 && gateDb > -90;
  let audioSourceLabel = '[0:a]';
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
  const wantsAudioFx = wantsVolume || wantsGate;

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
  } else if (preChain.length > 0) {
    mapV = videoSourceLabel;
    mapA = wantsAudioFx ? audioSourceLabel : '0:a?';
  } else if (wantsAudioFx) {
    mapV = '0:v';
    mapA = audioSourceLabel;
  } else {
    mapV = '0:v';
    mapA = '0:a?';
  }

  const args: string[] = ['-y', '-hide_banner', '-stats', '-i', opts.videoPath];
  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }
  args.push('-map', mapV, '-map', mapA);
  if (filterParts.length > 0) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20');
    args.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-c', 'copy');
  }
  args.push('-movflags', '+faststart', outPath);

  let totalSec: number | null = null;
  onProgress(0, 'evt:export.starting');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, args);
    let err = '';
    let lastMilestone = -1;
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (totalSec == null) totalSec = parseDurationFromStderr(err);
      const den = progressDuration ?? totalSec;
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
    child.on('error', reject);
    child.on('close', (code) => {
      if (srtTransformed && srtTransformed !== opts.subtitles?.srtPath) {
        try { fs.unlinkSync(srtTransformed); } catch {}
      }
      if (code === 0) {
        onProgress(100, 'evt:export.done');
        resolve(outPath);
      } else {
        reject(new Error('evt:err.export'));
      }
    });
  });
}
