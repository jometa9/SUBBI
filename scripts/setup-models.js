const fs = require('fs');
const path = require('path');
const https = require('https');

const MODELS = [
  { name: 'ggml-tiny.bin',     bytes:    77_691_713 },
  { name: 'ggml-medium.bin',   bytes: 1_533_763_059 },
  { name: 'ggml-large-v3.bin', bytes: 3_094_623_511 },
];

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const DEST_DIR = path.resolve(__dirname, '..', 'resources', 'whisper');

const RNNOISE_DIR = path.resolve(__dirname, '..', 'resources', 'rnnoise');
const RNNOISE_MODEL = {
  name: 'cb.rnnn',
  url: 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/conjoined-burgers-2018-08-28/cb.rnnn',
};

function fmtMB(n) { return (n / (1024 * 1024)).toFixed(1) + ' MB'; }

function download(url, dest, expectedBytes) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const file = fs.createWriteStream(tmp);
    const req = (u) => https.get(u, { headers: { 'User-Agent': 'subbi-setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return req(res.headers.location);
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        fs.unlink(tmp, () => {});
        return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
      }
      const total = Number(res.headers['content-length']) || expectedBytes;
      let got = 0;
      let lastPrint = 0;
      res.on('data', (c) => {
        got += c.length;
        const now = Date.now();
        if (now - lastPrint > 500) {
          lastPrint = now;
          const pct = total ? ((got / total) * 100).toFixed(1) : '?';
          process.stdout.write(`\r  ${path.basename(dest)}  ${fmtMB(got)} / ${fmtMB(total)}  (${pct}%)   `);
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        process.stdout.write('\n');
        fs.rename(tmp, dest, (err) => err ? reject(err) : resolve());
      }));
    });
    req(url).on('error', (err) => {
      file.close();
      fs.unlink(tmp, () => {});
      reject(err);
    });
  });
}

async function main() {
  fs.mkdirSync(DEST_DIR, { recursive: true });

  const todo = [];
  for (const m of MODELS) {
    const p = path.join(DEST_DIR, m.name);
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      if (size === m.bytes) {
        console.log(`✓ ${m.name} already present (${fmtMB(size)})`);
        continue;
      }
      console.log(`✗ ${m.name} exists but size ${fmtMB(size)} ≠ ${fmtMB(m.bytes)}, re-downloading`);
      fs.unlinkSync(p);
    }
    todo.push(m);
  }

  if (todo.length === 0) {
    console.log('All whisper models ready.');
    return;
  }

  const totalMB = todo.reduce((s, m) => s + m.bytes, 0) / (1024 * 1024);
  console.log(`Downloading ${todo.length} model(s), ~${totalMB.toFixed(0)} MB total. This is a one-time setup.`);

  for (const m of todo) {
    const dest = path.join(DEST_DIR, m.name);
    console.log(`→ ${m.name}`);
    await download(BASE_URL + m.name, dest, m.bytes);
  }

  console.log('Done.');

  fs.mkdirSync(RNNOISE_DIR, { recursive: true });
  const rnnDest = path.join(RNNOISE_DIR, RNNOISE_MODEL.name);
  if (fs.existsSync(rnnDest) && fs.statSync(rnnDest).size > 1024) {
    console.log(`✓ RNNoise model already present (${RNNOISE_MODEL.name})`);
  } else {
    console.log(`→ RNNoise model ${RNNOISE_MODEL.name}`);
    try {
      await download(RNNOISE_MODEL.url, rnnDest, 0);
      console.log('RNNoise model ready.');
    } catch (err) {
      console.warn(`RNNoise model download failed: ${err.message}. Voice Cleanup will fall back to non-neural denoise.`);
    }
  }
}

main().catch((err) => {
  console.error('\nsetup-models failed:', err.message);
  console.error('You can retry with: npm run setup:models');
  process.exit(1);
});
