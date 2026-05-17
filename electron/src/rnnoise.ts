import fs from 'fs';
import path from 'path';
import { app } from 'electron';

let cached: string | null | undefined;

export function findRnnoiseModel(): string | null {
  if (cached !== undefined) return cached;
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'rnnoise', 'cb.rnnn')
    : path.resolve(__dirname, '..', '..', 'resources', 'rnnoise', 'cb.rnnn');
  cached = fs.existsSync(candidate) ? candidate : null;
  return cached;
}

export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
