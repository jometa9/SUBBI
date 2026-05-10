# Subbi

App de Electron para arrastrar un video y obtener subtítulos quemados, con whisper local (whisper.cpp) y ffmpeg.

## Requisitos

- Node.js 18+
- ffmpeg en el PATH
  - `winget install Gyan.FFmpeg`
- (Windows) los modelos `bsb-00*.dat` y `whisper-cli.exe` ya están en `resources/whisper/` (copiados desde Bisbi).

## Dev

```powershell
npm install
npm run dev
```

Abre la ventana de Electron contra el dev server de Vite (puerto 5180).

## Uso

1. Arrastrá un video (mp4/mov/mkv/webm/avi) o hacé click en "Abrir video".
2. Elegí idioma y modelo, dale "Transcribir". Cuando termina, se previsualizan los subtítulos en el reproductor.
3. Ajustá fuente / tamaño / color / contorno / posición / mayúsculas-minúsculas — la preview se actualiza en vivo (overlay HTML).
4. "Quemar subtítulos al video" exporta `<nombre>.subtitled.<ext>` al lado del original con esos estilos aplicados via ffmpeg `subtitles` filter (ASS `force_style`).

## Notas

- La preview del estilo es una aproximación: el overlay HTML usa la misma fuente/tamaño/color, pero el render final lo hace libass dentro de ffmpeg. La fuente debe estar instalada en el sistema.
- "Tamaño" en preview ≠ tamaño exacto en el burn (depende de la resolución del video). El campo se aplica como `FontSize` ASS sobre `PlayResY=720` por defecto.
- "Posición" se interpreta como % de altura desde abajo, mapeado a `MarginV` ASS asumiendo PlayResY=720.

## Próximo

- Detectar y eliminar silencios del video (probablemente con ffmpeg `silencedetect` + `select`/`atrim`).
