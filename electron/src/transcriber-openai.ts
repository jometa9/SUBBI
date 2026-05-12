import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';

export interface OpenAITranscribeOptions {
  videoPath: string;
  language: string;
  apiKey: string;
}

export interface OpenAITranscribeResult {
  srtPath: string;
  srt: string;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODEL = 'whisper-1';
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
const AUDIO_BITRATE_KBPS = 32;

function ffprobeDuration(ffmpeg: string, input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', input], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function extractMp3(
  ffmpeg: string,
  videoPath: string,
  outPath: string,
  totalSec: number,
  onProgress: (extractPct: number) => void,
  startSec?: number,
  durSec?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['-y', '-hide_banner', '-stats'];
    if (startSec != null) args.push('-ss', String(startSec));
    args.push('-i', videoPath);
    if (durSec != null) args.push('-t', String(durSec));
    args.push(
      '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', `${AUDIO_BITRATE_KBPS}k`,
      outPath,
    );
    const child = spawn(ffmpeg, args);
    child.stderr.on('data', d => {
      const s = d.toString();
      for (const line of s.split(/\r|\n/)) {
        const t = parseTimeFromStderr(line);
        if (t != null && totalSec > 0) {
          onProgress(Math.min(100, (t / totalSec) * 100));
        }
      }
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('evt:err.audioPrep')));
  });
}

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

function formatSrtTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.round((totalSec - Math.floor(totalSec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

type Segment = { start: number; end: number; text: string };

async function callOpenAI(
  apiKey: string,
  audioPath: string,
  language: string,
): Promise<Segment[]> {
  const data = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);
  const blob = new Blob([data], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('model', OPENAI_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (language && language !== 'auto') form.append('language', language);

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    if (res.status === 401) throw new Error('evt:err.openaiAuth');
    if (res.status === 429) throw new Error('evt:err.openaiRate');
    throw new Error('evt:err.openaiRequest' + (detail ? `:${res.status}` : ''));
  }

  const json: any = await res.json();
  const segs: any[] = Array.isArray(json?.segments) ? json.segments : [];
  return segs
    .map(s => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    }))
    .filter(s => s.text.length > 0 && s.end > s.start);
}

function buildSrt(segments: Segment[]): string {
  const lines: string[] = [];
  segments.forEach((s, i) => {
    lines.push(String(i + 1));
    lines.push(`${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}`);
    lines.push(s.text);
    lines.push('');
  });
  return lines.join('\n');
}

export async function transcribeOpenAI(
  opts: OpenAITranscribeOptions,
  onProgress: (pct: number, line: string) => void,
): Promise<OpenAITranscribeResult> {
  if (!opts.apiKey || !opts.apiKey.trim()) throw new Error('evt:err.openaiKeyMissing');

  const ffmpeg = findFfmpeg();
  const tmpDir = path.join(os.tmpdir(), 'subbi');
  fs.mkdirSync(tmpDir, { recursive: true });
  const sessionId = randomUUID();
  const fullMp3 = path.join(tmpDir, `${sessionId}.mp3`);
  const chunkPaths: string[] = [];

  try {
    onProgress(0, 'evt:transcribe.extractingAudio');
    const totalSec = await ffprobeDuration(ffmpeg, opts.videoPath);

    let lastExtractMilestone = -1;
    await extractMp3(ffmpeg, opts.videoPath, fullMp3, totalSec, (pct) => {
      const overall = Math.min(20, (pct / 100) * 20);
      const milestone = Math.floor(pct / 25) * 25;
      if (milestone > lastExtractMilestone && milestone > 0 && milestone < 100) {
        lastExtractMilestone = milestone;
        onProgress(overall, `evt:transcribe.extractingProgress:${milestone}`);
      } else {
        onProgress(overall, '');
      }
    });
    onProgress(20, 'evt:transcribe.audioReady');

    const size = fs.statSync(fullMp3).size;
    const chunks: { path: string; offset: number }[] = [];

    if (size <= MAX_CHUNK_BYTES) {
      chunks.push({ path: fullMp3, offset: 0 });
    } else {
      const bytesPerSec = (AUDIO_BITRATE_KBPS * 1000) / 8;
      const chunkSec = Math.max(60, Math.floor((MAX_CHUNK_BYTES / bytesPerSec) * 0.9));
      let offset = 0;
      let idx = 0;
      while (offset < totalSec) {
        const dur = Math.min(chunkSec, totalSec - offset);
        const p = path.join(tmpDir, `${sessionId}.part${idx}.mp3`);
        await extractMp3(ffmpeg, opts.videoPath, p, dur, () => {}, offset, dur);
        chunkPaths.push(p);
        chunks.push({ path: p, offset });
        offset += dur;
        idx++;
      }
    }

    onProgress(25, 'evt:transcribe.starting');
    const allSegments: Segment[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const segs = await callOpenAI(opts.apiKey, c.path, opts.language);
      for (const s of segs) {
        allSegments.push({
          start: s.start + c.offset,
          end: s.end + c.offset,
          text: s.text,
        });
      }
      const pct = 25 + Math.round(((i + 1) / chunks.length) * 70);
      const milestone = Math.floor(((i + 1) / chunks.length) * 100 / 10) * 10;
      onProgress(pct, milestone > 0 && milestone < 100
        ? `evt:transcribe.progress:${milestone}` : '');
    }

    onProgress(96, 'evt:transcribe.savingSubtitles');
    const srt = buildSrt(allSegments);
    if (!srt.trim()) throw new Error('evt:err.subtitlesMissing');

    const finalSrt = path.join(
      path.dirname(opts.videoPath),
      path.basename(opts.videoPath, path.extname(opts.videoPath)) + '.srt'
    );
    fs.writeFileSync(finalSrt, srt, 'utf8');

    onProgress(100, 'evt:transcribe.done');
    return { srtPath: finalSrt, srt };
  } finally {
    try { fs.unlinkSync(fullMp3); } catch {}
    for (const p of chunkPaths) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
}
