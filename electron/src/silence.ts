import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';

export interface SilenceRange {
  start: number;
  end: number;
}

export interface DetectSilencesOptions {
  videoPath: string;
  thresholdDb?: number;   // if omitted, auto = mean_volume - 12
  minDurSec?: number;     // default 0.5
}

export interface DetectSilencesResult {
  silences: SilenceRange[];
  duration: number;
  thresholdDb: number;
  meanVolumeDb: number | null;
}

export interface CutSilencesOptions {
  videoPath: string;
  keepRanges: SilenceRange[]; // segments to KEEP (concatenated in order)
}

export interface ExtractPeaksResult {
  peaks: number[];     // normalized 0..1, one per bin
  duration: number;    // seconds
  sampleRate: number;  // bins per second (effective)
}

function ffprobeDuration(ffmpeg: string, videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', videoPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', () => {
      const dur = parseDurationFromStderr(err);
      if (dur == null) reject(new Error('evt:err.duration'));
      else resolve(dur);
    });
  });
}

function getMeanVolume(ffmpeg: string, videoPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-nostats',
      '-i', videoPath,
      '-vn', '-af', 'volumedetect',
      '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const m = err.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      resolve(m ? parseFloat(m[1]) : null);
    });
  });
}

export async function detectSilences(opts: DetectSilencesOptions): Promise<DetectSilencesResult> {
  const ffmpeg = findFfmpeg();
  const minDur = opts.minDurSec ?? 0.5;

  const [duration, mean] = await Promise.all([
    ffprobeDuration(ffmpeg, opts.videoPath),
    getMeanVolume(ffmpeg, opts.videoPath),
  ]);

  const threshold = opts.thresholdDb ?? (mean != null ? Math.max(-60, mean - 12) : -30);

  const silences = await new Promise<SilenceRange[]>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-nostats',
      '-i', opts.videoPath,
      '-vn', '-af', `silencedetect=noise=${threshold}dB:d=${minDur}`,
      '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', () => {
      const out: SilenceRange[] = [];
      const startRe = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
      const endRe = /silence_end:\s*(-?\d+(?:\.\d+)?)/g;
      const starts: number[] = [];
      const ends: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = startRe.exec(err)) !== null) starts.push(parseFloat(m[1]));
      while ((m = endRe.exec(err)) !== null) ends.push(parseFloat(m[1]));
      const n = Math.min(starts.length, ends.length);
      for (let i = 0; i < n; i++) {
        const s = Math.max(0, starts[i]);
        const e = Math.min(duration, ends[i]);
        if (e > s) out.push({ start: s, end: e });
      }
      // Trailing silence (started but never ended before EOF)
      if (starts.length > ends.length) {
        const s = Math.max(0, starts[starts.length - 1]);
        if (duration > s) out.push({ start: s, end: duration });
      }
      resolve(out);
    });
  });

  return { silences, duration, thresholdDb: threshold, meanVolumeDb: mean };
}

// Decode the audio with ffmpeg into low-rate PCM and bin into peaks for waveform display.
export async function extractPeaks(videoPath: string, targetBins = 2000): Promise<ExtractPeaksResult> {
  const ffmpeg = findFfmpeg();
  const duration = await ffprobeDuration(ffmpeg, videoPath);

  const buf = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-nostats',
      '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error('evt:err.waveform'));
    });
  });

  const totalSamples = Math.floor(buf.length / 2);
  if (totalSamples === 0) return { peaks: [], duration, sampleRate: 0 };

  const bins = Math.min(targetBins, totalSamples);
  const binSize = Math.max(1, Math.floor(totalSamples / bins));
  const peaks: number[] = new Array(bins).fill(0);
  let bin = 0;
  let max = 0;
  for (let i = 0; i < totalSamples && bin < bins; i++) {
    const v = Math.abs(buf.readInt16LE(i * 2)) / 32768;
    if (v > max) max = v;
    if ((i + 1) % binSize === 0) {
      peaks[bin++] = max;
      max = 0;
    }
  }
  return { peaks, duration, sampleRate: bins / Math.max(duration, 0.001) };
}

// Build the keep-ranges from the user's edited timeline and produce a cut video.
export async function cutSilences(
  opts: CutSilencesOptions,
  onProgress: (pct: number, line: string) => void
): Promise<string> {
  const ffmpeg = findFfmpeg();
  const ranges = (opts.keepRanges || [])
    .map(r => ({ start: Math.max(0, r.start), end: r.end }))
    .filter(r => r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) throw new Error('evt:err.noSegments');

  const ext = path.extname(opts.videoPath);
  const base = path.basename(opts.videoPath, ext);
  const outPath = path.join(path.dirname(opts.videoPath), `${base}.nosilence${ext}`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  // Build filter_complex. Must split [0:v] / [0:a] into N copies before trimming each.
  const n = ranges.length;
  const vSplitOuts = Array.from({ length: n }, (_, i) => `[vsplit${i}]`).join('');
  const aSplitOuts = Array.from({ length: n }, (_, i) => `[asplit${i}]`).join('');
  const parts: string[] = [
    `[0:v]split=${n}${vSplitOuts}`,
    `[0:a]asplit=${n}${aSplitOuts}`,
  ];
  const concatLabels: string[] = [];
  ranges.forEach((r, i) => {
    parts.push(
      `[vsplit${i}]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
    parts.push(
      `[asplit${i}]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatLabels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${concatLabels.join('')}concat=n=${n}:v=1:a=1[outv][outa]`);
  const filter = parts.join(';');

  let totalSec: number | null = null;
  // Final output duration is the sum of kept ranges; use it for progress mapping.
  const outDuration = ranges.reduce((s, r) => s + (r.end - r.start), 0);
  onProgress(0, 'evt:cut.starting');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-y', '-hide_banner', '-stats',
      '-i', opts.videoPath,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
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
        if (t != null) {
          const pct = Math.min(100, (t / outDuration) * 100);
          const milestone = Math.floor(pct / 10) * 10;
          if (milestone > lastMilestone && milestone > 0 && milestone < 100) {
            lastMilestone = milestone;
            onProgress(pct, `evt:cut.progress:${milestone}`);
          } else {
            onProgress(pct, '');
          }
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        onProgress(100, 'evt:cut.done');
        resolve(outPath);
      } else {
        reject(new Error('evt:err.cut'));
      }
    });
  });
}
