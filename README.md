# Subbi

Drop a video, get burned-in subtitles. Local Whisper + ffmpeg.

## Install

```bash
git clone <repo-url> subbi
cd subbi
npm install
```

`npm install` also downloads the three whisper.cpp models into `resources/whisper/`:

| Model | File | Size |
| --- | --- | --- |
| Tiny (fast) | `ggml-tiny.bin` | ~75 MB |
| Medium | `ggml-medium.bin` | ~1.5 GB |
| Large v3 (accurate) | `ggml-large-v3.bin` | ~3.1 GB |

Total: ~4.7 GB. One-time download; if it gets interrupted, run `npm run setup:models` again.

## Run in dev

```bash
npm run dev
```

## Build

```bash
npm run package
```
