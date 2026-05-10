import { app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';

export type WhisperModel = 'tiny' | 'medium' | 'large';

export interface TranscribeOptions {
  videoPath: string;
  language: string;
  model: WhisperModel;
}

export interface TranscribeResult {
  srtPath: string;
  srt: string;
}

const MODEL_FILE: Record<WhisperModel, string> = {
  tiny:   'bsb-001.dat',
  medium: 'bsb-002.dat',
  large:  'bsb-004.dat',
};

function resourceRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'whisper');
  return path.resolve(__dirname, '..', '..', 'resources', 'whisper');
}

function whisperBinary(): string {
  const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  return path.join(resourceRoot(), 'win32-x64', name);
}

function modelPath(m: WhisperModel): string {
  return path.join(resourceRoot(), MODEL_FILE[m]);
}

export async function transcribe(
  opts: TranscribeOptions,
  onProgress: (pct: number, line: string) => void
): Promise<TranscribeResult> {
  const ffmpeg = findFfmpeg();
  const bin = whisperBinary();
  const model = modelPath(opts.model);
  if (!fs.existsSync(bin)) throw new Error(`whisper-cli no encontrado: ${bin}`);
  if (!fs.existsSync(model)) throw new Error(`Modelo no encontrado: ${model}`);

  const tmpDir = path.join(os.tmpdir(), 'subbi');
  fs.mkdirSync(tmpDir, { recursive: true });
  const wavPath = path.join(tmpDir, `${randomUUID()}.wav`);

  try {
    // 1) Extract WAV 16kHz mono from video
    let totalSec: number | null = null;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-y', '-hide_banner', '-stats',
        '-i', opts.videoPath,
        '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        wavPath,
      ]);
      let err = '';
      child.stderr.on('data', (d) => {
        const s = d.toString();
        err += s;
        if (totalSec == null) totalSec = parseDurationFromStderr(err);
        if (totalSec) {
          for (const line of s.split(/\r|\n/)) {
            const t = parseTimeFromStderr(line);
            if (t != null) {
              const pct = Math.min(100, (t / totalSec) * 100 * 0.15); // extract = 0..15%
              onProgress(pct, `[ffmpeg-extract] ${line.trim()}`);
            }
          }
        }
      });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg extract failed (${code}): ${err.slice(-400)}`)));
    });

    // 2) Run whisper
    const threads = Math.max(2, Math.floor(os.cpus().length / 2));
    const args = [
      '-m', model,
      '-f', wavPath,
      '-l', opts.language || 'auto',
      '-osrt',
      '--max-len', '42',
      '--split-on-word',
      '-t', String(threads),
      '--temperature', '0.0',
      '--no-speech-thold', '0.6',
      '--suppress-nst',
      '-fa',
      '-pp',
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stdout.on('data', (d) => {
        const s = d.toString();
        for (const line of s.split(/\r?\n/)) {
          if (!line) continue;
          // Whisper prints "progress = NN%"
          const m = line.match(/progress\s*=\s*(\d+)%/);
          if (m) {
            const whisperPct = +m[1];
            // map whisper 0..100 -> overall 15..98
            const pct = 15 + (whisperPct / 100) * 83;
            onProgress(pct, line.trim());
          } else {
            onProgress(15, line.trim());
          }
        }
      });
      child.stderr.on('data', (d) => {
        const s = d.toString();
        err += s;
        for (const line of s.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const m = line.match(/progress\s*=\s*(\d+)%/);
          if (m) {
            const whisperPct = +m[1];
            const pct = 15 + (whisperPct / 100) * 83;
            onProgress(pct, line.trim());
          }
        }
      });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`whisper-cli failed (${code}): ${err.slice(-400)}`)));
    });

    // 3) Read SRT next to wav
    const srtPath = `${wavPath}.srt`;
    if (!fs.existsSync(srtPath)) throw new Error('whisper no generó .srt');
    const srt = fs.readFileSync(srtPath, 'utf8');

    // Move SRT next to video
    const finalSrt = path.join(
      path.dirname(opts.videoPath),
      path.basename(opts.videoPath, path.extname(opts.videoPath)) + '.srt'
    );
    try { fs.copyFileSync(srtPath, finalSrt); } catch { /* keep tmp if copy fails */ }

    onProgress(100, 'done');
    return { srtPath: fs.existsSync(finalSrt) ? finalSrt : srtPath, srt };
  } finally {
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
    try { fs.unlinkSync(`${wavPath}.srt`); } catch { /* ignore */ }
  }
}
