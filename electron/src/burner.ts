import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  fontWeight?: 'normal' | 'semibold' | 'bold';
  color: string;
  outline: string;
  outlineEnabled?: boolean;
  marginVPct: number;
  marginHPct: number;
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
}

export interface BurnOptions {
  videoPath: string;
  srtPath: string;
  style: SubtitleStyle;
}

function hexToAssColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '&H00FFFFFF';
  const r = m[1].slice(0, 2);
  const g = m[1].slice(2, 4);
  const b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

type Cue = { start: number; end: number; text: string };

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
    const start = toSec(matches[0]);
    const end = toSec(matches[1]);
    const textLines = lines.slice(lines.indexOf(tline) + 1);
    out.push({ start, end, text: textLines.join('\n').trim() });
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

function transformSrt(srtPath: string, textCase: SubtitleStyle['textCase'], maxWords: number): string {
  const needsResegment = maxWords && maxWords > 0;
  if (textCase === 'asis' && !needsResegment) return srtPath;
  const raw = fs.readFileSync(srtPath, 'utf8');
  let cues = parseSrt(raw);
  if (needsResegment) cues = resegmentByWords(cues, maxWords);
  if (textCase !== 'asis') {
    cues = cues.map(c => ({
      ...c,
      text: textCase === 'upper' ? c.text.toLocaleUpperCase() : c.text.toLocaleLowerCase(),
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

export async function burn(
  opts: BurnOptions,
  onProgress: (pct: number, line: string) => void
): Promise<string> {
  const ffmpeg = findFfmpeg();
  const srtToUse = transformSrt(opts.srtPath, opts.style.textCase, opts.style.maxWords);

  const ext = path.extname(opts.videoPath);
  const base = path.basename(opts.videoPath, ext);
  const outPath = path.join(path.dirname(opts.videoPath), `${base}.subtitled${ext}`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const marginV = Math.round(720 * (opts.style.marginVPct / 100));
  const hShift = Math.round(1280 * ((opts.style.marginHPct || 0) / 100));
  const marginL = Math.max(0, 2 * hShift);
  const marginR = Math.max(0, -2 * hShift);

  const outlineOn = opts.style.outlineEnabled !== false;
  const styleParts = [
    `FontName=${opts.style.fontName}`,
    `FontSize=${opts.style.fontSize}`,
    `PrimaryColour=${hexToAssColor(opts.style.color)}`,
    `OutlineColour=${hexToAssColor(opts.style.outline)}`,
    `BorderStyle=1`,
    `Outline=${outlineOn ? 2 : 0}`,
    `Shadow=0`,
    `Alignment=2`,
    `MarginV=${marginV}`,
    `MarginL=${marginL}`,
    `MarginR=${marginR}`,
    `Bold=${opts.style.fontWeight === 'normal' ? 0 : 1}`,
  ].join(',');

  const vf = `subtitles='${escapeForFilter(srtToUse)}':force_style='${styleParts}'`;

  let totalSec: number | null = null;
  onProgress(0, 'evt:burn.starting');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-y', '-hide_banner', '-stats',
      '-i', opts.videoPath,
      '-vf', vf,
      '-c:a', 'copy',
      outPath,
    ]);

    let err = '';
    let lastMilestone = -1;
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (totalSec == null) totalSec = parseDurationFromStderr(err);
      for (const line of s.split(/\r|\n/)) {
        if (!line.trim()) continue;
        const t = parseTimeFromStderr(line);
        if (t != null && totalSec) {
          const pct = Math.min(100, (t / totalSec) * 100);
          const milestone = Math.floor(pct / 10) * 10;
          if (milestone > lastMilestone && milestone > 0 && milestone < 100) {
            lastMilestone = milestone;
            onProgress(pct, `evt:burn.progress:${milestone}`);
          } else {
            onProgress(pct, '');
          }
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (srtToUse !== opts.srtPath) {
        try { fs.unlinkSync(srtToUse); } catch {}
      }
      if (code === 0) {
        onProgress(100, 'evt:burn.done');
        resolve(outPath);
      } else {
        reject(new Error('evt:err.burn'));
      }
    });
  });
}
