import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { app } from 'electron';

let cached: string | null = null;

function bundledFfmpeg(): string | null {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  // Production: extraResources copies the binary to <Resources>/ffmpeg/<exe>
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'ffmpeg', exe);
    return fs.existsSync(p) ? p : null;
  }
  // Dev: resolve from ffmpeg-static in node_modules
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ff = require('ffmpeg-static') as string | null;
    if (ff && fs.existsSync(ff)) return ff;
  } catch { /* ignore */ }
  return null;
}

export function findFfmpeg(): string {
  if (cached) return cached;

  // 1) Bundled binary (always preferred — guarantees a working ffmpeg)
  const bundled = bundledFfmpeg();
  if (bundled) {
    cached = bundled;
    return bundled;
  }

  // 2) PATH
  try {
    const out = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) {
      cached = first;
      return first;
    }
  } catch { /* ignore */ }

  // 3) Common Windows install locations
  if (process.platform === 'win32') {
    const home = process.env.LOCALAPPDATA || '';
    const candidates: string[] = [];
    const wingetRoot = path.join(home, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetRoot)) {
      for (const d of fs.readdirSync(wingetRoot)) {
        if (d.toLowerCase().includes('ffmpeg')) {
          const pkgDir = path.join(wingetRoot, d);
          // walk one level for ffmpeg-*-build/bin/ffmpeg.exe
          for (const sub of fs.readdirSync(pkgDir)) {
            const exe = path.join(pkgDir, sub, 'bin', 'ffmpeg.exe');
            if (fs.existsSync(exe)) candidates.push(exe);
          }
        }
      }
    }
    candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
    candidates.push(path.join(process.env['ProgramFiles'] || '', 'ffmpeg', 'bin', 'ffmpeg.exe'));
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        cached = c;
        return c;
      }
    }
  }

  throw new Error('ffmpeg no encontrado.');
}

// Read total duration via ffprobe-less: parse from stderr "Duration: HH:MM:SS.ms"
export function parseDurationFromStderr(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!m) return null;
  const ms = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + ms / 1000;
}

export function parseTimeFromStderr(line: string): number | null {
  const m = line.match(/time=\s*(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!m) return null;
  const ms = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + ms / 1000;
}
