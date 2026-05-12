import { app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { findFfmpeg, parseDurationFromStderr, parseTimeFromStderr } from './ffmpeg';
import { transcribeOpenAI } from './transcriber-openai';

export type WhisperModel = 'tiny' | 'medium';
export type TranscribeEngine = 'local' | 'openai';

export interface TranscribeOptions {
  videoPath: string;
  language: string;
  model: WhisperModel;
  engine?: TranscribeEngine;
  apiKey?: string;
}

export interface TranscribeResult {
  srtPath: string;
  srt: string;
}

const MODEL_FILE: Record<WhisperModel, string> = {
  tiny:   'ggml-tiny.bin',
  medium: 'ggml-medium.bin',
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
  if (opts.engine === 'openai') {
    return transcribeOpenAI(
      { videoPath: opts.videoPath, language: opts.language, apiKey: opts.apiKey || '' },
      onProgress,
    );
  }
  const ffmpeg = findFfmpeg();
  const bin = whisperBinary();
  const model = modelPath(opts.model);
  if (!fs.existsSync(bin)) throw new Error('evt:err.transcriberMissing');
  if (!fs.existsSync(model)) throw new Error('evt:err.modelMissing');

  const tmpDir = path.join(os.tmpdir(), 'subbi');
  fs.mkdirSync(tmpDir, { recursive: true });
  const wavPath = path.join(tmpDir, `${randomUUID()}.wav`);

  try {
    onProgress(0, 'evt:transcribe.extractingAudio');
    let totalSec: number | null = null;
    let lastExtractMilestone = -1;
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
              const pct = Math.min(100, (t / totalSec) * 100 * 0.15);
              const phasePct = Math.min(100, Math.round((t / totalSec) * 100));
              const milestone = Math.floor(phasePct / 25) * 25;
              if (milestone > lastExtractMilestone && milestone > 0 && milestone < 100) {
                lastExtractMilestone = milestone;
                onProgress(pct, `evt:transcribe.extractingProgress:${milestone}`);
              } else {
                onProgress(pct, '');
              }
            }
          }
        }
      });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('evt:err.audioPrep')));
    });
    onProgress(15, 'evt:transcribe.audioReady');

    onProgress(15, 'evt:transcribe.starting');
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

    let lastWhisperMilestone = -1;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      const handleOut = (s: string) => {
        for (const line of s.split(/\r?\n/)) {
          if (!line) continue;
          const m = line.match(/progress\s*=\s*(\d+)%/);
          if (m) {
            const whisperPct = +m[1];
            const pct = 15 + (whisperPct / 100) * 83;
            const milestone = Math.floor(whisperPct / 10) * 10;
            if (milestone > lastWhisperMilestone && milestone > 0 && milestone < 100) {
              lastWhisperMilestone = milestone;
              onProgress(pct, `evt:transcribe.progress:${milestone}`);
            } else {
              onProgress(pct, '');
            }
          }
        }
      };
      child.stdout.on('data', (d) => handleOut(d.toString()));
      child.stderr.on('data', (d) => { const s = d.toString(); err += s; handleOut(s); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('evt:err.transcribe')));
    });

    onProgress(98, 'evt:transcribe.savingSubtitles');
    const srtPath = `${wavPath}.srt`;
    if (!fs.existsSync(srtPath)) throw new Error('evt:err.subtitlesMissing');
    const srt = fs.readFileSync(srtPath, 'utf8');

    const finalSrt = path.join(
      path.dirname(opts.videoPath),
      path.basename(opts.videoPath, path.extname(opts.videoPath)) + '.srt'
    );
    try { fs.copyFileSync(srtPath, finalSrt); } catch {}

    onProgress(100, 'evt:transcribe.done');
    return { srtPath: fs.existsSync(finalSrt) ? finalSrt : srtPath, srt };
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(`${wavPath}.srt`); } catch {}
  }
}
