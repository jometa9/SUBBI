import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';

export type WhisperModel = 'tiny' | 'medium';

interface ModelSpec {
  file: string;
  url: string;
  bytes: number;
}

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

const MODELS: Record<WhisperModel, ModelSpec> = {
  tiny: {
    file: 'ggml-tiny.bin',
    url: BASE_URL + 'ggml-tiny.bin',
    bytes: 77_691_713,
  },
  medium: {
    file: 'ggml-medium.bin',
    url: BASE_URL + 'ggml-medium.bin',
    bytes: 1_533_763_059,
  },
};

function resourceWhisperRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'whisper');
  return path.resolve(__dirname, '..', '..', 'resources', 'whisper');
}

function userModelsDir(): string {
  const dir = path.join(app.getPath('userData'), 'whisper-models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function modelSpec(m: WhisperModel): ModelSpec {
  return MODELS[m];
}

export function userModelPath(m: WhisperModel): string {
  return path.join(userModelsDir(), MODELS[m].file);
}

export function resolveModelPath(m: WhisperModel): string | null {
  const user = userModelPath(m);
  if (isValid(user, MODELS[m].bytes)) return user;
  const bundled = path.join(resourceWhisperRoot(), MODELS[m].file);
  if (isValid(bundled, MODELS[m].bytes)) return bundled;
  return null;
}

export function hasModel(m: WhisperModel): boolean {
  return resolveModelPath(m) != null;
}

function isValid(p: string, expectedBytes: number): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    const size = fs.statSync(p).size;
    return size === expectedBytes;
  } catch {
    return false;
  }
}

const inflight = new Map<WhisperModel, Promise<void>>();

export function downloadModel(
  m: WhisperModel,
  onProgress: (pct: number, line: string) => void,
): Promise<void> {
  const existing = inflight.get(m);
  if (existing) return existing;
  if (hasModel(m)) return Promise.resolve();

  const spec = MODELS[m];
  const dest = userModelPath(m);
  const tmp = dest + '.part';

  const p = new Promise<void>((resolve, reject) => {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    const file = fs.createWriteStream(tmp);

    const cleanup = (err: Error) => {
      try { file.close(); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      reject(err);
    };

    const req = (u: string, redirects: number) => {
      if (redirects > 5) return cleanup(new Error('evt:err.modelDownload'));
      https.get(u, { headers: { 'User-Agent': 'subbi-app' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return req(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanup(new Error('evt:err.modelDownload'));
        }
        const total = Number(res.headers['content-length']) || spec.bytes;
        let got = 0;
        let lastEmit = 0;
        let lastMilestone = -1;
        onProgress(0, `evt:modelDl.start`);
        res.on('data', (c) => {
          got += c.length;
          const now = Date.now();
          const pct = total ? Math.min(100, (got / total) * 100) : 0;
          const milestone = Math.floor(pct / 10) * 10;
          if (milestone > lastMilestone && milestone > 0 && milestone < 100) {
            lastMilestone = milestone;
            onProgress(pct, `evt:modelDl.progress:${milestone}`);
            lastEmit = now;
          } else if (now - lastEmit > 250) {
            onProgress(pct, '');
            lastEmit = now;
          }
        });
        res.pipe(file);
        file.on('error', cleanup);
        file.on('finish', () => {
          file.close((closeErr) => {
            if (closeErr) return cleanup(closeErr);
            try {
              const size = fs.statSync(tmp).size;
              if (total && size !== total) {
                return cleanup(new Error('evt:err.modelDownload'));
              }
              fs.renameSync(tmp, dest);
              onProgress(100, `evt:modelDl.done`);
              resolve();
            } catch (e) {
              cleanup(e as Error);
            }
          });
        });
      }).on('error', cleanup);
    };

    req(spec.url, 0);
  }).finally(() => {
    inflight.delete(m);
  });

  inflight.set(m, p);
  return p;
}
