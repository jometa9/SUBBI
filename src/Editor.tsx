import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SilenceTimeline, { type SilenceRegion, type SilenceTimelineHandle } from './SilenceTimeline';
import CropOverlay, { type CropRect } from './CropOverlay';
import Select from './Select';
import ColorPicker from './ColorPicker';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type Cue = { start: number; end: number; text: string; edited?: boolean };
type WordTs = { word: string; start: number; end: number };

type SubtitleStyle = {
  fontName: string;
  fontSize: number;
  fontWeight: 'normal' | 'semibold' | 'bold';
  color: string;
  outline: string;
  outlineEnabled: boolean;
  outlineWidth: number;
  marginVPct: number;
  marginHPct: number;
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
};

type ProcessState =
  | { phase: 'idle' }
  | { phase: 'transcribing'; pct: number; log: string }
  | { phase: 'detecting' }
  | { phase: 'exporting'; pct: number; log: string }
  | { phase: 'exported'; outPath: string }
  | { phase: 'error'; message: string };

const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Arial',
  fontSize: 28,
  fontWeight: 'bold',
  color: '#FFFFFF',
  outline: '#000000',
  outlineEnabled: true,
  outlineWidth: 2,
  marginVPct: 25,
  marginHPct: 0,
  textCase: 'asis',
  maxWords: 4,
};

const FONT_OPTIONS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];

type AspectPreset = { id: string; label: string; ratio: number | null };
const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
];

type BlackScreenPreset = { id: string; label: string; w: number; h: number };
const BLACK_SCREEN_PRESETS: BlackScreenPreset[] = [
  { id: '9:16', label: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { id: '16:9', label: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { id: '4:5', label: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { id: '4:3', label: '4:3 · 1440×1080', w: 1440, h: 1080 },
];
const DEFAULT_BLACK_SCREEN_ASPECT = '9:16';

export type UiLang = 'en' | 'es';

export const TRANSLATIONS: Record<UiLang, Record<string, string>> = {
  en: {
    openVideo: 'Open video',
    dropHere: 'Drop a video here',
    dropNow: 'Release to drop',
    sampleSubtitle: 'Sample subtitle',
    clickToEditCue: 'Click to edit subtitle (Enter to save · Esc to cancel)',
    transcription: 'Transcription',
    language: 'Language',
    langSpanish: 'Spanish', langEnglish: 'English', langPortuguese: 'Portuguese', langAuto: 'Auto',
    model: 'Model',
    modelFast: 'Fast', modelMedium: 'Medium', modelCloud: 'Cloud',
    apiKey: 'OpenAI API key',
    apiKeyShow: 'Show',
    apiKeyHide: 'Hide',
    apiKeyClear: 'Clear',
    apiKeyHint: 'Your key is saved locally on this machine. You can clear it anytime.',
    openaiKeyMissing: 'Enter your OpenAI API key first.',
    transcribe: 'Transcribe', transcribing: 'Transcribing',
    removeTranscriptions: 'Remove transcriptions',
    removeTranscriptionsTitle: 'Discard the generated subtitles for this video.',
    subtitleStyle: 'Subtitle style',
    font: 'Font', size: 'Size', vertical: 'Vertical', horizontal: 'Horizontal',
    color: 'Color', outline: 'Outline', outlineWidth: 'Outline width',
    styleApplyToAll: 'Apply to all segments',
    subtitlesEnabled: 'Show and export subtitles',
    textCase: 'Case', caseAsIs: 'As is', caseUpper: 'UPPERCASE', caseLower: 'lowercase',
    maxPerLine: 'Max words',
    couldNotReadPath: 'Could not read file path. Try "Open video".',
    notAVideo: 'Only video files are accepted (mp4, mov, mkv, webm, avi, m4v).',
    silenceSection: 'Silence removal',
    detectSilences: 'Detect silences', detecting: 'Detecting',
    threshold: 'Threshold', minDuration: 'Min duration',
    autoMean: 'Auto (mean − 12 dB)',
    silencesFound: 'silences found',
    clickRegionToToggle: 'Click red regions to keep them. Drag edges to adjust. Double-click purple regions to remove them.',
    noSilences: 'No silences detected at this threshold.',
    addManualExclusion: 'Exclude at cursor',
    cropSection: 'Crop',
    aspectRatio: 'Aspect ratio',
    enableCrop: 'Enable crop',
    resetCrop: 'Reset',
    disableCrop: 'Disable',
    cropPixels: 'Pixels',
    cropX: 'X',
    cropY: 'Y',
    cropW: 'W',
    cropH: 'H',
    audioSection: 'Audio',
    audioGain: 'Volume gain',
    audioGainHint: 'Boost or attenuate the audio track on export.',
    audioGate: 'Noise gate',
    audioGateHint: 'Mute audio below the threshold (keeps voice, drops low-level noise).',
    audioGateOff: 'Off',
    voiceCleanup: 'Voice cleanup (export only)',
    voiceCleanupIntensity: 'Intensity',
    voiceCleanupLight: 'Light',
    voiceCleanupMedium: 'Medium',
    voiceCleanupStrong: 'Strong',
    voiceCleanupHint: 'Pro voice chain: highpass + RNNoise + denoise + compressor + loudness normalize. Applied on export, or render a full preview below.',
    voiceCleanupPreviewOn: 'Apply to preview',
    voiceCleanupPreviewOff: 'Use original',
    voiceCleanupPreviewCancel: 'Cancel',
    bgAudioAdd: 'Add background audio',
    bgAudioRemove: 'Remove background audio',
    bgAudioVolume: 'Background audio volume',
    bgAudioMute: 'Mute background audio',
    bgAudioLoading: 'Loading background audio…',
    bgAudioInvalid: 'Could not load this audio file.',
    bgAudioDragHint: 'Drag to move · drag handles to trim',
    exportSection: 'Export',
    exportNow: 'Export video',
    exporting: 'Exporting',
    exportDone: 'Export complete',
    cancelExport: 'Cancel export',
    exportCancelled: 'Export cancelled.',
    nothingToExport: 'No edits to export — nothing to do.',
    showInFolder: 'Show in folder',
    untitledProject: 'Untitled Project',
    sectionCrop: 'Crop',
    sectionSilence: 'Silence',
    sectionTranscription: 'Transcription',
    sectionSubtitleStyle: 'Subtitle style',
    sectionTemplates: 'Templates',
    templateSaveCurrent: 'Save current as template',
    templateNamePlaceholder: 'Template name',
    templateSaveBtn: 'Save',
    templateCancelBtn: 'Cancel',
    templateApply: 'Apply',
    templateDelete: 'Delete',
    templateEmpty: 'No templates yet. Save your current settings to reuse them on other videos.',
    templateSavedToast: 'Template saved',
    templateAppliedToast: 'Template applied',
    templateConfirmDelete: 'Delete this template?',
    templateNameRequired: 'Enter a name',
    weight: 'Weight',
    weightNormal: 'Regular',
    weightSemibold: 'Semibold',
    weightBold: 'Bold',
    cues: 'cues',
    generatingWaveform: 'Generating waveform…',
    pillSilence: 'SILENCE',
    pillSubs: 'SUBS',
    pillCrop: 'CROP',
    pillAudio: 'AUDIO',
    aspectFree: 'Free',
    pause: 'Pause',
    play: 'Play',
    mute: 'Mute',
    unmute: 'Unmute',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Reset',
    splitHere: 'Split here',
    cancelSplitHere: 'Cancel split here',
    removeSplit: 'Remove split',
    splitsBadge: 'splits',
    cropZoneHere: 'New crop zone here',
    cropZoneRemove: 'Remove zone',
    cropZonesBadge: 'zones',
    cropActiveZone: 'Active zone {n}/{total}',
    cropApply: 'Apply',
    cropEdit: 'Edit',
    cropFit: 'Fit',
    cropFill: 'Fill',
    cropAlign: 'Align',
    cropAlignLeft: 'Align left',
    cropAlignRight: 'Align right',
    cropAlignTop: 'Align top',
    cropAlignBottom: 'Align bottom',
    cropBg: 'Background',
    cropBgBlack: 'Black',
    cropBgWhite: 'White',
    cropApplyToAll: 'Apply to all segments',
    sectionFilters: 'Filters',
    filterSaturation: 'Saturation',
    filterOpacity: 'Opacity',
    filterOpacityBg: 'Background',
    blackScreenSection: 'Black screen (audio only)',
    blackScreenEnable: 'Enable black screen',
    blackScreenFormat: 'Format',
    blackScreenBg: 'Background',
    blackScreenHint: 'Replaces the image with a solid background at the chosen size. Audio, cuts and subtitles are kept — ideal for audio-only videos with subtitles.',
    filterSpeed: 'Speed',
    previewSpeed: 'Preview speed',
    previewSpeedTitle: 'Preview playback speed (does not affect export)',
    timelapseSection: 'Timelapse',
    timelapseEnable: 'Enable timelapse',
    timelapseTarget: 'Target duration',
    timelapseSeconds: 'sec',
    timelapseMute: 'Mute original audio',
    timelapseHint: 'Speeds up the video so its duration (after silence cuts) matches the target.',
    timelapseComputed: 'Computed speed: {x}× (base {base}s → target {target}s)',
    timelapseExtreme: 'Very high speed — preview may differ from final export.',
    timelapseNoBase: 'Load a video to compute timelapse speed.',
    timelapseOverrideSpeed: 'Overrides Speed in Filters while enabled.',
    exportPartsHint: 'Export will produce one file per segment.',
    excludeSegment: 'Exclude from export',
    includeSegment: 'Include in export',
    segmentLabel: 'Segment {n}',
    segmentsIncluded: 'included',
    segmentsCountTip: '{in} included · {out} excluded',
    zoomTimeline: 'Zoom timeline',
    zoomReset: 'Reset zoom',
    modelDownloadIntro: 'The {model} model is not installed yet.',
    modelDownloading: 'Downloading {model} ({pct}%)',
    modelReady: '{model} model ready.',
    modelDownloadRetry: 'Retry',
    modelSizeFast: '~74 MB',
    modelSizeMedium: '~1.46 GB',
    'log.modelDl.start': 'Downloading model…',
    'log.modelDl.progress': 'Downloading model: {pct}%',
    'log.modelDl.done': 'Model ready.',
    'log.transcribe.extractingAudio': 'Preparing audio…',
    'log.transcribe.extractingProgress': 'Preparing audio: {pct}%',
    'log.transcribe.audioReady': 'Audio ready.',
    'log.transcribe.starting': 'Generating subtitles…',
    'log.transcribe.progress': 'Generating subtitles: {pct}%',
    'log.transcribe.savingSubtitles': 'Saving subtitle file…',
    'log.transcribe.done': 'Subtitles ready.',
    'log.export.starting': 'Preparing export…',
    'log.export.progress': 'Exporting: {pct}%',
    'log.export.done': 'Export finished.',
    'log.export.cancelled': 'Export cancelled.',
    'log.export.segment': 'Exporting segment {n}/{total}…',
    'log.cut.starting': 'Trimming silences…',
    'log.cut.progress': 'Trimming: {pct}%',
    'log.cut.done': 'Trim finished.',
    'log.burn.starting': 'Burning subtitles…',
    'log.burn.progress': 'Burning: {pct}%',
    'log.burn.done': 'Burn finished.',
    'err.engineMissing': 'A required component is missing.',
    'err.transcriberMissing': 'The transcription engine is missing.',
    'err.modelMissing': 'The transcription model is missing.',
    'err.modelDownload': 'Could not download the model. Check your connection and retry.',
    'err.audioPrep': 'Could not prepare the audio for transcription.',
    'err.transcribe': 'Transcription failed.',
    'err.subtitlesMissing': 'No subtitles were produced.',
    'err.openaiKeyMissing': 'OpenAI API key is required.',
    'err.openaiAuth': 'OpenAI rejected the API key. Check it and try again.',
    'err.openaiRate': 'OpenAI rate limit reached. Try again in a moment.',
    'err.openaiRequest': 'OpenAI transcription request failed.',
    'err.export': 'Export failed.',
    'err.cut': 'Trimming failed.',
    'err.burn': 'Subtitle burn failed.',
    'err.duration': 'Could not read the video duration.',
    'err.waveform': 'Could not generate the waveform.',
    'err.noSegments': 'There are no segments to keep.',
    storageLabel: 'Saved · {size}',
    storageTooltip: 'Auto-saved edits use {total} across {count} project(s). Other projects: {others} ({othersCount}).',
    clearOthers: 'Clear others',
    clearOthersTitle: 'Remove auto-saved data for {count} other project(s) — frees {size}.',
    clearOthersNone: 'No other projects saved.',
    confirmClearOthers: 'Remove auto-saved edits for {count} other project(s)? This will free {size}. The current project is kept.',
    resetEdits: 'Reset edits',
    resetEditsTitle: 'Remove all edits and start from scratch (keeps the transcription).',
    resetConfirm: 'Click again to confirm',
    resetSection: 'Reset',
    resetSectionTitle: 'Reset this section to defaults',
    themeSystem: 'Theme: System (click to switch to Light)',
    themeLight: 'Theme: Light (click to switch to Dark)',
    themeDark: 'Theme: Dark (click to switch to System)',
    resetNothing: 'Nothing to reset.',
    tabUntitled: 'New project',
    tabNew: 'New tab',
    tabClose: 'Close tab',
    tabMaxReached: 'Maximum {n} tabs',
    updateAvailable: 'New version {v} available',
    updateDownload: 'Download',
    updateDismiss: 'Dismiss',
  },
  es: {
    openVideo: 'Abrir video',
    dropHere: 'Soltá un video aquí',
    dropNow: 'Soltalo ahora',
    sampleSubtitle: 'Subtítulo de ejemplo',
    clickToEditCue: 'Click para editar el subtítulo (Enter para guardar · Esc para cancelar)',
    transcription: 'Transcripción',
    language: 'Idioma',
    langSpanish: 'Español', langEnglish: 'Inglés', langPortuguese: 'Portugués', langAuto: 'Auto',
    model: 'Modelo',
    modelFast: 'Rápido', modelMedium: 'Medio', modelCloud: 'Nube',
    apiKey: 'API key de OpenAI',
    apiKeyShow: 'Mostrar',
    apiKeyHide: 'Ocultar',
    apiKeyClear: 'Borrar',
    apiKeyHint: 'Tu clave se guarda localmente en esta máquina. Podés borrarla cuando quieras.',
    openaiKeyMissing: 'Ingresá tu API key de OpenAI primero.',
    transcribe: 'Transcribir', transcribing: 'Transcribiendo',
    removeTranscriptions: 'Quitar transcripciones',
    removeTranscriptionsTitle: 'Descartar los subtítulos generados para este video.',
    subtitleStyle: 'Estilo del subtítulo',
    font: 'Fuente', size: 'Tamaño', vertical: 'Vertical', horizontal: 'Horizontal',
    color: 'Color', outline: 'Contorno', outlineWidth: 'Grosor del contorno',
    styleApplyToAll: 'Aplicar a todos los segmentos',
    subtitlesEnabled: 'Mostrar y exportar subtítulos',
    textCase: 'Mayús/minús', caseAsIs: 'Tal cual', caseUpper: 'MAYÚSCULAS', caseLower: 'minúsculas',
    maxPerLine: 'Máx palabras',
    couldNotReadPath: 'No se pudo leer la ruta del archivo. Probá con "Abrir video".',
    notAVideo: 'Solo se aceptan archivos de video (mp4, mov, mkv, webm, avi, m4v).',
    silenceSection: 'Quitar silencios',
    detectSilences: 'Detectar silencios', detecting: 'Detectando',
    threshold: 'Umbral', minDuration: 'Duración mín.',
    autoMean: 'Auto (promedio − 12 dB)',
    silencesFound: 'silencios encontrados',
    clickRegionToToggle: 'Click en las regiones rojas para conservarlas. Arrastrá los bordes para ajustar. Doble click en regiones violetas para eliminarlas.',
    noSilences: 'No se detectaron silencios con este umbral.',
    addManualExclusion: 'Excluir en cursor',
    cropSection: 'Recortar',
    aspectRatio: 'Relación de aspecto',
    enableCrop: 'Activar recorte',
    resetCrop: 'Restablecer',
    disableCrop: 'Desactivar',
    cropPixels: 'Píxeles',
    cropX: 'X',
    cropY: 'Y',
    cropW: 'W',
    cropH: 'H',
    audioSection: 'Audio',
    audioGain: 'Ganancia de volumen',
    audioGainHint: 'Subí o bajá el audio del video al exportar.',
    audioGate: 'Puerta de ruido',
    audioGateHint: 'Silencia el audio por debajo del umbral (mantiene la voz, baja el ruido).',
    audioGateOff: 'Apagada',
    voiceCleanup: 'Limpieza de voz (solo al exportar)',
    voiceCleanupIntensity: 'Intensidad',
    voiceCleanupLight: 'Suave',
    voiceCleanupMedium: 'Media',
    voiceCleanupStrong: 'Fuerte',
    voiceCleanupHint: 'Cadena pro de voz: highpass + RNNoise + denoise + compresor + normalización de volumen. Se aplica al exportar, o renderizá una preview completa abajo.',
    voiceCleanupPreviewOn: 'Aplicar al preview',
    voiceCleanupPreviewOff: 'Usar original',
    voiceCleanupPreviewCancel: 'Cancelar',
    bgAudioAdd: 'Agregar audio de fondo',
    bgAudioRemove: 'Quitar audio de fondo',
    bgAudioVolume: 'Volumen del audio de fondo',
    bgAudioMute: 'Silenciar audio de fondo',
    bgAudioLoading: 'Cargando audio de fondo…',
    bgAudioInvalid: 'No se pudo cargar este archivo de audio.',
    bgAudioDragHint: 'Arrastrá para mover · arrastrá los bordes para recortar',
    exportSection: 'Exportar',
    exportNow: 'Exportar video',
    exporting: 'Exportando',
    exportDone: 'Exportación completa',
    cancelExport: 'Cancelar exportación',
    exportCancelled: 'Exportación cancelada.',
    nothingToExport: 'No hay ediciones para exportar.',
    showInFolder: 'Mostrar en carpeta',
    untitledProject: 'Proyecto sin título',
    sectionCrop: 'Recortar',
    sectionSilence: 'Silencios',
    sectionTranscription: 'Transcripción',
    sectionSubtitleStyle: 'Estilo del subtítulo',
    sectionTemplates: 'Plantillas',
    templateSaveCurrent: 'Guardar configuración actual como plantilla',
    templateNamePlaceholder: 'Nombre de la plantilla',
    templateSaveBtn: 'Guardar',
    templateCancelBtn: 'Cancelar',
    templateApply: 'Aplicar',
    templateDelete: 'Eliminar',
    templateEmpty: 'Aún no hay plantillas. Guardá tu configuración actual para reutilizarla en otros videos.',
    templateSavedToast: 'Plantilla guardada',
    templateAppliedToast: 'Plantilla aplicada',
    templateConfirmDelete: '¿Eliminar esta plantilla?',
    templateNameRequired: 'Ingresá un nombre',
    weight: 'Peso',
    weightNormal: 'Regular',
    weightSemibold: 'Semibold',
    weightBold: 'Bold',
    cues: 'subtítulos',
    generatingWaveform: 'Generando forma de onda…',
    pillSilence: 'SILENCIO',
    pillSubs: 'SUBS',
    pillCrop: 'RECORTE',
    pillAudio: 'AUDIO',
    aspectFree: 'Libre',
    pause: 'Pausar',
    play: 'Reproducir',
    mute: 'Silenciar',
    unmute: 'Activar audio',
    back5s: '−5s',
    fwd5s: '+5s',
    resetAudio: 'Restablecer',
    splitHere: 'Cortar aquí',
    cancelSplitHere: 'Cancelar corte aquí',
    removeSplit: 'Quitar corte',
    splitsBadge: 'cortes',
    cropZoneHere: 'Nueva zona de crop aquí',
    cropZoneRemove: 'Quitar zona',
    cropZonesBadge: 'zonas',
    cropActiveZone: 'Zona activa {n}/{total}',
    cropApply: 'Aplicar',
    cropEdit: 'Editar',
    cropFit: 'Encajar',
    cropFill: 'Rellenar',
    cropAlign: 'Alinear',
    cropAlignLeft: 'Alinear a la izquierda',
    cropAlignRight: 'Alinear a la derecha',
    cropAlignTop: 'Alinear arriba',
    cropAlignBottom: 'Alinear abajo',
    cropBg: 'Fondo',
    cropBgBlack: 'Negro',
    cropBgWhite: 'Blanco',
    cropApplyToAll: 'Aplicar a todos los segmentos',
    sectionFilters: 'Filtros',
    filterSaturation: 'Saturación',
    filterOpacity: 'Opacidad',
    filterOpacityBg: 'Fondo',
    blackScreenSection: 'Pantalla negra (solo audio)',
    blackScreenEnable: 'Activar pantalla negra',
    blackScreenFormat: 'Formato',
    blackScreenBg: 'Fondo',
    blackScreenHint: 'Reemplaza la imagen por un fondo sólido del tamaño elegido. Se mantienen el audio, los cortes y los subtítulos — ideal para videos de solo audio con subtítulos.',
    filterSpeed: 'Velocidad',
    previewSpeed: 'Velocidad de previsualización',
    previewSpeedTitle: 'Velocidad de reproducción en la previsualización (no afecta al export)',
    timelapseSection: 'Timelapse',
    timelapseEnable: 'Activar timelapse',
    timelapseTarget: 'Duración objetivo',
    timelapseSeconds: 'seg',
    timelapseMute: 'Silenciar audio original',
    timelapseHint: 'Acelera el video para que su duración (sin contar silencios) coincida con el objetivo.',
    timelapseComputed: 'Velocidad calculada: {x}× (base {base}s → objetivo {target}s)',
    timelapseExtreme: 'Velocidad muy alta — la previsualización puede no coincidir con el export final.',
    timelapseNoBase: 'Carga un video para calcular la velocidad del timelapse.',
    timelapseOverrideSpeed: 'Reemplaza a Velocidad en Filtros mientras está activo.',
    exportPartsHint: 'Se exportará un archivo por cada segmento.',
    excludeSegment: 'Excluir del export',
    includeSegment: 'Incluir en el export',
    segmentLabel: 'Segmento {n}',
    segmentsIncluded: 'incluidos',
    segmentsCountTip: '{in} incluidos · {out} excluidos',
    zoomTimeline: 'Zoom de la timeline',
    zoomReset: 'Restablecer zoom',
    modelDownloadIntro: 'El modelo {model} aún no está instalado.',
    modelDownloading: 'Descargando {model} ({pct}%)',
    modelReady: 'Modelo {model} listo.',
    modelDownloadRetry: 'Reintentar',
    modelSizeFast: '~74 MB',
    modelSizeMedium: '~1.46 GB',
    'log.modelDl.start': 'Descargando modelo…',
    'log.modelDl.progress': 'Descargando modelo: {pct}%',
    'log.modelDl.done': 'Modelo listo.',
    'log.transcribe.extractingAudio': 'Preparando audio…',
    'log.transcribe.extractingProgress': 'Preparando audio: {pct}%',
    'log.transcribe.audioReady': 'Audio listo.',
    'log.transcribe.starting': 'Generando subtítulos…',
    'log.transcribe.progress': 'Generando subtítulos: {pct}%',
    'log.transcribe.savingSubtitles': 'Guardando archivo de subtítulos…',
    'log.transcribe.done': 'Subtítulos listos.',
    'log.export.starting': 'Preparando exportación…',
    'log.export.progress': 'Exportando: {pct}%',
    'log.export.done': 'Exportación finalizada.',
    'log.export.cancelled': 'Exportación cancelada.',
    'log.export.segment': 'Exportando segmento {n}/{total}…',
    'log.cut.starting': 'Quitando silencios…',
    'log.cut.progress': 'Quitando silencios: {pct}%',
    'log.cut.done': 'Silencios quitados.',
    'log.burn.starting': 'Incrustando subtítulos…',
    'log.burn.progress': 'Incrustando: {pct}%',
    'log.burn.done': 'Subtítulos incrustados.',
    'err.engineMissing': 'Falta un componente requerido.',
    'err.transcriberMissing': 'Falta el motor de transcripción.',
    'err.modelMissing': 'Falta el modelo de transcripción.',
    'err.modelDownload': 'No se pudo descargar el modelo. Revisá la conexión y reintentá.',
    'err.audioPrep': 'No se pudo preparar el audio para transcribir.',
    'err.transcribe': 'La transcripción falló.',
    'err.subtitlesMissing': 'No se generaron subtítulos.',
    'err.openaiKeyMissing': 'Falta la API key de OpenAI.',
    'err.openaiAuth': 'OpenAI rechazó la API key. Revisala e intentá de nuevo.',
    'err.openaiRate': 'Límite de uso de OpenAI alcanzado. Probá en un rato.',
    'err.openaiRequest': 'La transcripción con OpenAI falló.',
    'err.export': 'La exportación falló.',
    'err.cut': 'No se pudieron quitar los silencios.',
    'err.burn': 'No se pudieron incrustar los subtítulos.',
    'err.duration': 'No se pudo leer la duración del video.',
    'err.waveform': 'No se pudo generar la forma de onda.',
    'err.noSegments': 'No hay segmentos para conservar.',
    storageLabel: 'Guardado · {size}',
    storageTooltip: 'Las ediciones autoguardadas ocupan {total} en {count} proyecto(s). Otros proyectos: {others} ({othersCount}).',
    clearOthers: 'Limpiar otros',
    clearOthersTitle: 'Borrar el autoguardado de {count} proyecto(s) — libera {size}.',
    clearOthersNone: 'No hay otros proyectos guardados.',
    confirmClearOthers: '¿Borrar las ediciones autoguardadas de {count} proyecto(s)? Vas a liberar {size}. El proyecto actual se conserva.',
    resetEdits: 'Restablecer edits',
    resetEditsTitle: 'Quitar todas las ediciones y arrancar desde cero (la transcripción se conserva).',
    resetConfirm: 'Click de nuevo para confirmar',
    resetSection: 'Restablecer',
    resetSectionTitle: 'Restablecer esta sección a sus valores por defecto',
    resetNothing: 'No hay nada que restablecer.',
    themeSystem: 'Tema: Sistema (clic para cambiar a Claro)',
    themeLight: 'Tema: Claro (clic para cambiar a Oscuro)',
    themeDark: 'Tema: Oscuro (clic para cambiar a Sistema)',
    tabUntitled: 'Nuevo proyecto',
    tabNew: 'Nueva pestaña',
    tabClose: 'Cerrar pestaña',
    tabMaxReached: 'Máximo {n} pestañas',
    updateAvailable: 'Nueva versión {v} disponible',
    updateDownload: 'Descargar',
    updateDismiss: 'Cerrar',
  },
};

export function detectUiLang(): UiLang {
  const nav = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || '';
  const langs = (typeof navigator !== 'undefined' && (navigator as any).languages) || [nav];
  for (const l of langs) if (typeof l === 'string' && l.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

function parseSrt(srt: string): Cue[] {
  const out: Cue[] = [];
  const blocks = srt.replace(/\r/g, '').split(/\n\n+/);
  const tsRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g;
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const tline = lines.find(l => l.includes('-->'));
    if (!tline) continue;
    const matches = [...tline.matchAll(tsRe)];
    if (matches.length < 2) continue;
    const toMs = (m: RegExpMatchArray) =>
      (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    out.push({
      start: toMs(matches[0]),
      end: toMs(matches[1]),
      text: lines.slice(lines.indexOf(tline) + 1).join('\n').trim(),
    });
  }
  return out;
}

function formatSrt(cues: Cue[]): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const fmt = (sec: number) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`)
    .join('\n');
}

const WORD_GAP_BREAK_SEC = 0.5;
const SENTENCE_END_RE = /[.!?…¿¡]$/;

function groupByWordTimestamps(words: WordTs[], maxWords: number): Cue[] {
  if (!words || words.length === 0) return [];
  const cap = maxWords && maxWords > 0 ? maxWords : Infinity;
  const out: Cue[] = [];
  let bucket: WordTs[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    out.push({
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
      text: bucket.map(w => w.word).join(' ').replace(/\s+([,.;:!?…])/g, '$1'),
    });
    bucket = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = bucket[bucket.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (prev && gap > WORD_GAP_BREAK_SEC) flush();
    bucket.push(w);
    if (bucket.length >= cap) { flush(); continue; }
    if (SENTENCE_END_RE.test(w.word)) flush();
  }
  flush();
  return out;
}

function resegmentByWords(cues: Cue[], maxWords: number): Cue[] {
  if (!maxWords || maxWords <= 0) return cues;
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.edited) { out.push(c); continue; }
    const words = c.text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) { out.push(c); continue; }
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
    const totalChars = chunks.reduce((s, x) => s + x.length, 0) || 1;
    const totalDur = c.end - c.start;
    let t = c.start;
    for (let i = 0; i < chunks.length; i++) {
      const dur = i === chunks.length - 1 ? c.end - t : totalDur * (chunks[i].length / totalChars);
      out.push({ start: t, end: t + dur, text: chunks[i] });
      t += dur;
    }
  }
  return out;
}

function applyCase(s: string, c: SubtitleStyle['textCase']) {
  if (c === 'upper') return s.toLocaleUpperCase();
  if (c === 'lower') return s.toLocaleLowerCase();
  return s;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}.${pad(ms)}`
    : `${pad(m)}:${pad(s)}.${pad(ms)}`;
}

function fmtRulerTime(sec: number, intervalSec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (intervalSec < 1) {
    const s = sec % 60;
    return `${pad(m)}:${s.toFixed(1).padStart(4, '0')}`;
  }
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function pickRulerInterval(targetSec: number): number {
  const niceSeconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const n of niceSeconds) if (n >= targetSec) return n;
  return niceSeconds[niceSeconds.length - 1];
}

const STORAGE_KEY = 'subbi:settings:v2';
const PROJECT_PREFIX = 'subbi:proj:v1:';
const TEMPLATES_KEY = 'subbi:templates:v1';
export const LAST_VIDEO_KEY = 'subbi:lastVideoPath:v1';

type TranscribeModel = 'fast' | 'medium' | 'cloud';

function normalizeModel(raw: unknown, engine?: unknown): TranscribeModel {
  if (engine === 'openai' || raw === 'cloud') return 'cloud';
  if (raw === 'fast' || raw === 'tiny') return 'fast';
  if (raw === 'medium' || raw === 'large') return 'medium';
  return 'medium';
}

function modelToBackend(m: TranscribeModel): { engine: 'local' | 'openai'; whisper: 'tiny' | 'medium' } {
  if (m === 'cloud') return { engine: 'openai', whisper: 'medium' };
  if (m === 'fast')  return { engine: 'local',  whisper: 'tiny' };
  return { engine: 'local', whisper: 'medium' };
}

type BgAudioState = {
  path: string;
  url: string;
  duration: number;
  peaks: number[];
  offset: number;
  inPoint: number;
  outPoint: number;
  volumeDb: number;
  muted: boolean;
};

type BgAudioPersist = Omit<BgAudioState, 'url'>;

type ProjectState = {
  silenceRegions: SilenceRegion[];
  thresholdDb: number;
  autoThreshold: boolean;
  meanVolumeDb: number | null;
  minSilenceDur: number;
  cropEnabled: boolean;
  crop: CropRect;
  cropBgColor: 'black' | 'white';
  aspectId: string;
  saturation: number;
  opacity: number;
  opacityBgColor: 'black' | 'white';
  blackScreenEnabled?: boolean;
  blackScreenAspectId?: string;
  blackScreenBgColor?: 'black' | 'white';
  volumeDb: number;
  noiseGateDb: number;
  noiseGateEnabled: boolean;
  voiceCleanupEnabled: boolean;
  voiceCleanupIntensity: 'light' | 'medium' | 'strong';
  srtPath: string | null;
  rawCues: Cue[] | null;
  wordsTs?: WordTs[] | null;
  style: SubtitleStyle;
  language: string;
  model: TranscribeModel;
  splitMarkers?: number[];
  cropMarkers?: number[];
  cropByZone?: Record<string, CropRect>;
  cropApplyToAll?: boolean;
  styleByZone?: Record<string, SubtitleStyle>;
  styleApplyToAll?: boolean;
  subtitlesEnabled?: boolean;
  excludedSegments?: Record<string, boolean>;
  currentTime?: number;
  timelineZoom?: number;
  previewZoom?: number;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  timelapseEnabled?: boolean;
  timelapseTargetSec?: number;
  timelapseMuteOriginal?: boolean;
  bgAudio?: BgAudioPersist | null;
};

function bgAudioToPersist(b: BgAudioState): BgAudioPersist {
  const { url: _url, ...rest } = b;
  return rest;
}

type BgAudioTrackLabels = {
  add: string;
  remove: string;
  loading: string;
  dragHint: string;
};

function BgAudioTrack(props: {
  bgAudio: BgAudioState | null;
  videoDuration: number;
  loading: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<BgAudioState>) => void;
  onDropFile: (e: React.DragEvent) => void;
  labels: BgAudioTrackLabels;
}) {
  const { bgAudio, videoDuration, loading, onAdd, onRemove, onChange, onDropFile, labels } = props;
  const [dropOver, setDropOver] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragKind, setDragKind] = useState<null | 'move' | 'in' | 'out'>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !bgAudio) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w <= 0 || h <= 0) return;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const peaks = bgAudio.peaks;
    if (!peaks || peaks.length === 0) return;
    const dur = bgAudio.duration || 1;
    const startBin = Math.floor((bgAudio.inPoint / dur) * peaks.length);
    const endBin = Math.ceil((bgAudio.outPoint / dur) * peaks.length);
    const count = Math.max(1, endBin - startBin);
    const mid = h / 2;
    ctx.fillStyle = 'rgba(120, 200, 255, 0.75)';
    const barW = Math.max(1, w / count);
    for (let i = 0; i < count; i++) {
      const p = peaks[startBin + i] ?? 0;
      const bh = Math.max(1, p * (h - 4));
      ctx.fillRect(i * barW, mid - bh / 2, Math.max(1, barW - 0.5), bh);
    }
  }, [bgAudio?.peaks, bgAudio?.inPoint, bgAudio?.outPoint, bgAudio?.duration]);

  useEffect(() => {
    if (!dragKind || !bgAudio || !trackRef.current) return;
    const trackEl = trackRef.current;
    const startRect = trackEl.getBoundingClientRect();
    const trackW = startRect.width;
    const startBg = { ...bgAudio };

    function pxToSec(px: number) { return (px / Math.max(1, trackW)) * videoDuration; }

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startMouseX;
      const dSec = pxToSec(dx);
      if (dragKind === 'move') {
        const clipLen = startBg.outPoint - startBg.inPoint;
        let newOffset = startBg.offset + dSec;
        newOffset = Math.max(0, Math.min(Math.max(0, videoDuration - 0.05), newOffset));
        if (newOffset + clipLen > videoDuration) {
          newOffset = Math.max(0, videoDuration - clipLen);
        }
        onChange({ offset: newOffset });
      } else if (dragKind === 'in') {
        let newIn = startBg.inPoint + dSec;
        newIn = Math.max(0, Math.min(startBg.outPoint - 0.1, newIn));
        const delta = newIn - startBg.inPoint;
        let newOffset = startBg.offset + delta;
        newOffset = Math.max(0, newOffset);
        onChange({ inPoint: newIn, offset: newOffset });
      } else if (dragKind === 'out') {
        let newOut = startBg.outPoint + dSec;
        newOut = Math.max(startBg.inPoint + 0.1, Math.min(startBg.duration, newOut));
        const maxOut = startBg.inPoint + (videoDuration - startBg.offset);
        if (newOut > maxOut) newOut = maxOut;
        onChange({ outPoint: newOut });
      }
    }
    function onUp() { setDragKind(null); }
    const startMouseX = (window as any).__bgAudioStartX ?? 0;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragKind, bgAudio?.path, bgAudio?.inPoint, bgAudio?.outPoint, bgAudio?.offset, bgAudio?.duration, videoDuration]);

  function startDrag(kind: 'move' | 'in' | 'out', e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    (window as any).__bgAudioStartX = e.clientX;
    setDragKind(kind);
  }

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!dropOver) setDropOver(true); },
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDropOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDropOver(false); },
    onDrop: (e: React.DragEvent) => { setDropOver(false); onDropFile(e); },
  };

  if (!bgAudio) {
    return (
      <div
        className={'audio-strip-bgtrack is-empty' + (dropOver ? ' is-drop-over' : '')}
        {...dropHandlers}
      >
        <button
          type="button"
          className="audio-strip-bgadd"
          onClick={onAdd}
          disabled={loading}
        >
          {loading ? labels.loading : `+ ${labels.add}`}
        </button>
      </div>
    );
  }

  const clipLen = Math.max(0, bgAudio.outPoint - bgAudio.inPoint);
  const leftPct = (Math.max(0, bgAudio.offset) / Math.max(0.001, videoDuration)) * 100;
  const widthPct = (clipLen / Math.max(0.001, videoDuration)) * 100;

  return (
    <div
      className={'audio-strip-bgtrack' + (dropOver ? ' is-drop-over' : '')}
      ref={trackRef}
      {...dropHandlers}
    >
      <div
        className={'audio-strip-bgclip' + (dragKind ? ' is-dragging' : '')}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        onMouseDown={(e) => startDrag('move', e)}
        title={labels.dragHint}
      >
        <canvas ref={canvasRef} className="audio-strip-bgclip-canvas" />
        <div
          className="audio-strip-bgclip-handle is-left"
          onMouseDown={(e) => startDrag('in', e)}
        />
        <div
          className="audio-strip-bgclip-handle is-right"
          onMouseDown={(e) => startDrag('out', e)}
        />
        <button
          type="button"
          className="audio-strip-bgclip-remove"
          title={labels.remove}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >×</button>
      </div>
    </div>
  );
}

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'];

export function isVideoPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase());
}

export function isAudioPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase());
}

function projectKey(videoPath: string): string {
  return PROJECT_PREFIX + videoPath;
}

function loadProject(videoPath: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(projectKey(videoPath));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p as ProjectState : null;
  } catch { return null; }
}

function saveProject(videoPath: string, state: ProjectState) {
  try { localStorage.setItem(projectKey(videoPath), JSON.stringify(state)); } catch {}
}

export type VideoTemplate = {
  id: string;
  name: string;
  createdAt: number;
  thresholdDb: number;
  autoThreshold: boolean;
  minSilenceDur: number;
  cropEnabled: boolean;
  crop: CropRect;
  cropBgColor: 'black' | 'white';
  aspectId: string;
  saturation: number;
  opacity: number;
  opacityBgColor: 'black' | 'white';
  blackScreenEnabled?: boolean;
  blackScreenAspectId?: string;
  blackScreenBgColor?: 'black' | 'white';
  cropByZone: Record<string, CropRect>;
  cropApplyToAll: boolean;
  style: SubtitleStyle;
  styleByZone: Record<string, SubtitleStyle>;
  styleApplyToAll: boolean;
  volumeDb: number;
  noiseGateDb: number;
  noiseGateEnabled: boolean;
  voiceCleanupEnabled: boolean;
  voiceCleanupIntensity: 'light' | 'medium' | 'strong';
  language: string;
  model: TranscribeModel;
  hadTranscription?: boolean;
};

function loadTemplates(): VideoTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(t => t && typeof t === 'object' && t.id && t.name) : [];
  } catch { return []; }
}

function saveTemplates(list: VideoTemplate[]) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list)); } catch {}
}

function newTemplateId(): string {
  return 'tpl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function autosaveStats(currentVideoPath: string | null): { total: number; others: number; count: number; othersCount: number } {
  let total = 0;
  let others = 0;
  let count = 0;
  let othersCount = 0;
  const currentKey = currentVideoPath ? projectKey(currentVideoPath) : null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PROJECT_PREFIX)) continue;
      const v = localStorage.getItem(k) ?? '';
      const bytes = (k.length + v.length) * 2;
      total += bytes;
      count += 1;
      if (k !== currentKey) { others += bytes; othersCount += 1; }
    }
  } catch {}
  return { total, others, count, othersCount };
}

function clearOtherProjects(currentVideoPath: string | null): number {
  const currentKey = currentVideoPath ? projectKey(currentVideoPath) : null;
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PROJECT_PREFIX)) continue;
      if (k === currentKey) continue;
      toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
  return toRemove.length;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const rounded = v >= 100 || i === 0 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${rounded} ${units[i]}`;
}

type PersistedSettings = {
  uiLang?: UiLang;
  language?: string;
  model?: TranscribeModel;
  style?: SubtitleStyle;
  theme?: ThemePref;
  openSections?: Record<string, boolean>;
  transcribeEngine?: 'local' | 'openai';
  openaiApiKey?: string;
};

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function saveSettings(partial: PersistedSettings) {
  try {
    const existing = loadSettings();
    const merged = { ...existing, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {}
}

export type { PersistedSettings };

const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };

function rangePct(value: number, min: number, max: number): React.CSSProperties {
  if (max === min) return { ['--pct' as any]: '0%' };
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return { ['--pct' as any]: `${pct}%` };
}

export type EditorProps = {
  initialVideoPath: string | null;
  uiLang: UiLang;
  onUiLangChange: (lang: UiLang) => void;
  themePref: ThemePref;
  resolvedTheme: ResolvedTheme;
  onThemePrefChange: (pref: ThemePref) => void;
  onVideoPathChange: (path: string | null) => void;
  onDropPaths?: (paths: string[]) => boolean;
  tabId: string;
  isActive: boolean;
};

export default function Editor(props: EditorProps) {
  const { initialVideoPath, uiLang, onUiLangChange, themePref, resolvedTheme, onThemePrefChange, onVideoPathChange, onDropPaths, tabId, isActive } = props;
  const initial = useMemo(loadSettings, []);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [language, setLanguage] = useState(initial.language ?? 'es');
  const [model, setModel] = useState<TranscribeModel>(normalizeModel(initial.model, initial.transcribeEngine));
  const [openaiApiKey, setOpenaiApiKey] = useState<string>(initial.openaiApiKey ?? '');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [style, setStyle] = useState<SubtitleStyle>({ ...DEFAULT_STYLE, ...(initial.style ?? {}) });
  const [proc, setProc] = useState<ProcessState>({ phase: 'idle' });
  const [modelStatus, setModelStatus] = useState<Record<'tiny' | 'medium', { phase: 'idle' | 'checking' | 'downloading' | 'present' | 'error'; pct?: number; error?: string }>>({
    tiny: { phase: 'idle' },
    medium: { phase: 'idle' },
  });
  const [currentTime, setCurrentTime] = useState(0);

  const [srtPath, setSrtPath] = useState<string | null>(null);
  const [rawCues, setRawCues] = useState<Cue[] | null>(null);
  const [wordsTs, setWordsTs] = useState<WordTs[] | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [editingCue, setEditingCue] = useState<Cue | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  const [silenceRegions, setSilenceRegions] = useState<SilenceRegion[]>([]);
  const [thresholdDb, setThresholdDb] = useState<number>(-30);
  const [autoThreshold, setAutoThreshold] = useState<boolean>(true);
  const [meanVolumeDb, setMeanVolumeDb] = useState<number | null>(null);
  const [minSilenceDur, setMinSilenceDur] = useState<number>(0.5);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const timelineRef = useRef<SilenceTimelineHandle>(null);

  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const lastZoomRef = useRef<number>(1);

  const [hoverPreview, setHoverPreview] = useState<
    { time: number; clientX: number; topY: number } | null
  >(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageRoRef = useRef<ResizeObserver | null>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const setStageRef = useCallback((el: HTMLDivElement | null) => {
    if (stageRef.current === el) return;
    stageRef.current = el;
    stageRoRef.current?.disconnect();
    stageRoRef.current = null;
    if (el) {
      const update = () => {
        const w = el.clientWidth, h = el.clientHeight;
        setStageSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      stageRoRef.current = ro;
    }
  }, []);

  const [scrollViewportW, setScrollViewportW] = useState<number>(800);

  const [cropEnabled, setCropEnabled] = useState<boolean>(false);
  const [cropEditing, setCropEditing] = useState<boolean>(false);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [cropBgColor, setCropBgColor] = useState<'black' | 'white'>('black');
  const [aspectId, setAspectId] = useState<string>('free');
  const [saturation, setSaturation] = useState<number>(100);
  const [opacity, setOpacity] = useState<number>(100);
  const [opacityBgColor, setOpacityBgColor] = useState<'black' | 'white'>('black');
  const [blackScreenEnabled, setBlackScreenEnabled] = useState<boolean>(false);
  const [blackScreenAspectId, setBlackScreenAspectId] = useState<string>(DEFAULT_BLACK_SCREEN_ASPECT);
  const [blackScreenBgColor, setBlackScreenBgColor] = useState<'black' | 'white'>('black');
  const [cropByZone, setCropByZone] = useState<Record<string, CropRect>>({});
  const [cropApplyToAll, setCropApplyToAll] = useState<boolean>(true);
  const [styleByZone, setStyleByZone] = useState<Record<string, SubtitleStyle>>({});
  const [styleApplyToAll, setStyleApplyToAll] = useState<boolean>(true);

  const [volumeDb, setVolumeDb] = useState<number>(0);
  const [noiseGateDb, setNoiseGateDb] = useState<number>(-40);
  const [noiseGateEnabled, setNoiseGateEnabled] = useState<boolean>(false);
  const [voiceCleanupEnabled, setVoiceCleanupEnabled] = useState<boolean>(false);
  const [voiceCleanupIntensity, setVoiceCleanupIntensity] = useState<'light' | 'medium' | 'strong'>('medium');
  const [vcPreviewPath, setVcPreviewPath] = useState<string | null>(null);
  const [vcPreviewBusy, setVcPreviewBusy] = useState<boolean>(false);
  const [vcPreviewPct, setVcPreviewPct] = useState<number>(0);
  const [vcPreviewIntensity, setVcPreviewIntensity] = useState<'light' | 'medium' | 'strong' | null>(null);

  useEffect(() => {
    if (!voiceCleanupEnabled && vcPreviewPath) revertVoiceCleanupPreview();
  }, [voiceCleanupEnabled]);

  useEffect(() => {
    setVcPreviewPath(null);
    setVcPreviewIntensity(null);
    setVcPreviewPct(0);
  }, [videoPath]);

  const [bgAudio, setBgAudio] = useState<BgAudioState | null>(null);
  const [bgAudioLoading, setBgAudioLoading] = useState(false);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioGateRef = useRef<GainNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioGateBufferRef = useRef<Float32Array | null>(null);
  const audioGateRafRef = useRef<number | null>(null);

  const [splitMarkers, setSplitMarkers] = useState<number[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);
  const [excludedSegments, setExcludedSegments] = useState<Record<string, boolean>>({});

  function addSplitAtCurrent() {
    if (!videoDuration) return;
    const t = Math.max(0, Math.min(videoDuration, currentTime));
    if (splitMarkers.some(m => Math.abs(m - t) < 0.05)) return;
    const seedCrop = cropForTime(t);
    const seedStyle = styleForTime(t);
    const newKey = t.toFixed(3);
    setSplitMarkers(prev => [...prev, t].sort((a, b) => a - b));
    setCropByZone(prev => (prev[newKey] ? prev : { ...prev, [newKey]: seedCrop }));
    setStyleByZone(prev => (prev[newKey] ? prev : { ...prev, [newKey]: seedStyle }));
  }
  function removeSelectedMarker() {
    if (selectedMarker == null) return;
    const targetKey = selectedMarker.toFixed(3);
    setSplitMarkers(prev => prev.filter(m => Math.abs(m - selectedMarker) > 1e-6));
    setCropByZone(prev => {
      if (!prev[targetKey]) return prev;
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
    setStyleByZone(prev => {
      if (!prev[targetKey]) return prev;
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
    setSelectedMarker(null);
  }

  function removeSplitAtCurrent() {
    const marker = splitMarkers.find(m => Math.abs(m - currentTime) < 0.5);
    if (marker == null) return;
    const targetKey = marker.toFixed(3);
    setSplitMarkers(prev => prev.filter(m => Math.abs(m - marker) > 1e-6));
    setCropByZone(prev => {
      if (!prev[targetKey]) return prev;
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
    setStyleByZone(prev => {
      if (!prev[targetKey]) return prev;
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
    if (selectedMarker != null && Math.abs(selectedMarker - marker) < 1e-6) setSelectedMarker(null);
  }

  const nearbyMarker = splitMarkers.find(m => Math.abs(m - currentTime) < 0.5) ?? null;

  const splitSegments = useMemo(() => {
    const dur = videoDuration || 0;
    const inner = [...splitMarkers]
      .filter(m => m > 0.01 && (dur === 0 || m < dur - 0.01))
      .sort((a, b) => a - b);
    const bounds = [0, ...inner, dur];
    const segs: { key: string; start: number; end: number }[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const s = bounds[i];
      const e = bounds[i + 1];
      if (e - s < 1e-6) continue;
      segs.push({ key: s.toFixed(3), start: s, end: e });
    }
    if (segs.length === 0 && dur > 0) segs.push({ key: '0.000', start: 0, end: dur });
    return segs;
  }, [splitMarkers, videoDuration]);

  function toggleSegmentExcluded(key: string) {
    setExcludedSegments(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key]; else next[key] = true;
      return next;
    });
  }

  const activeSegmentIdx = useMemo(() => {
    const i = splitSegments.findIndex(z => currentTime >= z.start && currentTime < z.end);
    return i >= 0 ? i : splitSegments.length - 1;
  }, [splitSegments, currentTime]);
  const activeSegment = splitSegments[activeSegmentIdx] ?? splitSegments[0];
  const activeSegmentKey = activeSegment?.key ?? '0.000';

  function cropForTime(t: number): CropRect {
    if (cropApplyToAll) return crop;
    const z = splitSegments.find(z => t >= z.start && t < z.end) ?? splitSegments[splitSegments.length - 1];
    return (z && cropByZone[z.key]) || crop;
  }
  const effectiveCrop: CropRect = (splitMarkers.length > 0 && !cropApplyToAll)
    ? (cropByZone[activeSegmentKey] ?? crop)
    : crop;

  function setEffectiveCrop(updater: CropRect | ((c: CropRect) => CropRect)) {
    const apply = (c: CropRect): CropRect =>
      typeof updater === 'function' ? (updater as (c: CropRect) => CropRect)(c) : updater;
    if (splitMarkers.length === 0 || cropApplyToAll) {
      setCrop(prev => apply(prev));
    } else {
      setCropByZone(prev => ({ ...prev, [activeSegmentKey]: apply(prev[activeSegmentKey] ?? crop) }));
    }
  }

  function styleForTime(t: number): SubtitleStyle {
    if (styleApplyToAll) return style;
    const z = splitSegments.find(z => t >= z.start && t < z.end) ?? splitSegments[splitSegments.length - 1];
    return (z && styleByZone[z.key]) || style;
  }
  const effectiveStyle: SubtitleStyle = (splitMarkers.length > 0 && !styleApplyToAll)
    ? (styleByZone[activeSegmentKey] ?? style)
    : style;

  function setEffectiveStyle(updater: SubtitleStyle | ((s: SubtitleStyle) => SubtitleStyle)) {
    const apply = (s: SubtitleStyle): SubtitleStyle =>
      typeof updater === 'function' ? (updater as (s: SubtitleStyle) => SubtitleStyle)(s) : updater;
    if (splitMarkers.length === 0 || styleApplyToAll) {
      setStyle(prev => apply(prev));
    } else {
      setStyleByZone(prev => ({ ...prev, [activeSegmentKey]: apply(prev[activeSegmentKey] ?? style) }));
    }
  }

  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  function armReset(key: string) {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    setConfirmReset(key);
    confirmTimerRef.current = window.setTimeout(() => setConfirmReset(null), 3500);
  }
  function clearArmedReset() {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmReset(null);
  }
  useEffect(() => {
    if (!confirmReset) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-reset-key="' + confirmReset + '"]')) return;
      clearArmedReset();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [confirmReset]);

  function resetCrop() {
    setCrop(DEFAULT_CROP);
    setAspectId('free');
    setCropEnabled(false);
    setCropByZone({});
    setCropApplyToAll(true);
  }
  function resetSilence() {
    setSilenceRegions([]);
    setThresholdDb(-30);
    setAutoThreshold(true);
    setMinSilenceDur(0.5);
  }
  function resetAudio() {
    setVolumeDb(0);
    setNoiseGateDb(-40);
    setNoiseGateEnabled(false);
    setVoiceCleanupEnabled(false);
    setVoiceCleanupIntensity('medium');
    revertVoiceCleanupPreview();
  }

  function revertVoiceCleanupPreview() {
    setVcPreviewPath(null);
    setVcPreviewIntensity(null);
    setVcPreviewPct(0);
    if (videoPath) {
      setVideoUrl('file:///' + videoPath.replace(/\\/g, '/'));
    }
  }

  async function applyVoiceCleanupPreview() {
    if (!videoPath || vcPreviewBusy) return;
    setVcPreviewBusy(true);
    setVcPreviewPct(0);
    try {
      const out = await window.subbi.renderVoiceCleanupPreview({
        videoPath,
        intensity: voiceCleanupIntensity,
      }, `${tabId}:vcPreview`);
      const v = videoRef.current;
      const t = v?.currentTime ?? 0;
      const wasPaused = v?.paused ?? true;
      setVcPreviewPath(out);
      setVcPreviewIntensity(voiceCleanupIntensity);
      const newUrl = 'file:///' + out.replace(/\\/g, '/');
      setVideoUrl(newUrl);
      requestAnimationFrame(() => {
        const vv = videoRef.current;
        if (vv) {
          try { vv.load(); } catch {}
          const onReady = () => {
            try { vv.currentTime = t; } catch {}
            if (!wasPaused) { try { vv.play(); } catch {} }
            vv.removeEventListener('loadedmetadata', onReady);
          };
          vv.addEventListener('loadedmetadata', onReady);
        }
      });
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (!raw.includes('evt:export.cancelled')) {
        setProc({ phase: 'error', message: tEvt(raw) || raw });
      }
    } finally {
      setVcPreviewBusy(false);
    }
  }

  async function cancelVoiceCleanupPreview() {
    try { await window.subbi.cancelVoiceCleanupPreview(`${tabId}:vcPreview`); } catch {}
    setVcPreviewBusy(false);
  }
  function resetFilters() {
    setSaturation(100);
    setOpacity(100);
    setOpacityBgColor('black');
    setPlaybackRate(1);
  }
  function resetTimelapse() {
    setTimelapseEnabled(false);
    setTimelapseTargetSec(60);
    setTimelapseMuteOriginal(true);
  }
  function resetBlackScreen() {
    setBlackScreenEnabled(false);
    setBlackScreenAspectId(DEFAULT_BLACK_SCREEN_ASPECT);
    setBlackScreenBgColor('black');
  }
  function resetStyle() {
    if (splitMarkers.length > 0) {
      setStyleByZone(prev => {
        const next = { ...prev };
        delete next[activeSegmentKey];
        return next;
      });
    } else {
      setStyle({ ...DEFAULT_STYLE });
      setStyleByZone({});
    }
  }
  function resetSplits() {
    setSplitMarkers([]);
    setSelectedMarker(null);
    setExcludedSegments({});
  }
  function renderSectionReset(key: string, run: () => void, canReset: boolean) {
    const armed = confirmReset === key;
    return (
      <span
        role="button"
        data-reset-key={key}
        className={'pr-section-reset' + (armed ? ' is-confirming' : '') + (!canReset ? ' is-disabled' : '')}
        title={armed ? t('resetConfirm') : t('resetSectionTitle')}
        aria-disabled={!canReset}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!canReset) return;
          if (armed) { run(); clearArmedReset(); }
          else armReset(key);
        }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 9 8 9" />
        </svg>
      </span>
    );
  }

  function resetAllEdits() {
    resetCrop();
    resetSilence();
    resetAudio();
    resetFilters();
    resetTimelapse();
    resetBlackScreen();
    resetStyle();
    resetSplits();
    setEditingCue(null);
    setEditingText('');
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewSpeed, setPreviewSpeed] = useState(1);
  const [timelapseEnabled, setTimelapseEnabled] = useState(false);
  const [timelapseTargetSec, setTimelapseTargetSec] = useState(60);
  const [timelapseMuteOriginal, setTimelapseMuteOriginal] = useState(true);

  const timelapseBaseDuration = useMemo(() => {
    if (!videoDuration) return 0;
    const cuts = silenceRegions.filter(r => r.enabled).map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    let total = 0;
    let cursor = 0;
    for (const c of cuts) {
      if (c.start > cursor) total += Math.min(c.start, videoDuration) - cursor;
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < videoDuration) total += videoDuration - cursor;
    return total;
  }, [videoDuration, silenceRegions]);
  const timelapseSpeed = timelapseEnabled && timelapseBaseDuration > 0 && timelapseTargetSec > 0
    ? timelapseBaseDuration / timelapseTargetSec
    : 1;
  const effectiveSpeed = timelapseEnabled && timelapseSpeed > 0 ? timelapseSpeed : playbackRate;

  const [previewZoom, setPreviewZoom] = useState(1);
  const ZOOM_MIN = 0.05, ZOOM_MAX = 8;

  function getFitScale(): number {
    const v = videoRef.current;
    const vw = v?.videoWidth || 0;
    const vh = v?.videoHeight || 0;
    const sw = stageRef.current?.clientWidth || 0;
    const sh = stageRef.current?.clientHeight || 0;
    if (!vw || !vh || !sw || !sh) return 1;
    return Math.min(sw / vw, sh / vh);
  }
  function zoomIn() {
    setPreviewZoom(z => {
      const fit = getFitScale();
      const curPct = Math.round(fit * z * 100);
      const nextPct = Math.floor(curPct / 10) * 10 + 10;
      const nextZoom = (nextPct / 100) / fit;
      return Math.min(ZOOM_MAX, nextZoom);
    });
  }
  function zoomOut() {
    setPreviewZoom(z => {
      const fit = getFitScale();
      const curPct = Math.round(fit * z * 100);
      const nextPct = Math.ceil(curPct / 10) * 10 - 10;
      if (nextPct <= 0) return Math.max(ZOOM_MIN, z / 2);
      const nextZoom = (nextPct / 100) / fit;
      return Math.max(ZOOM_MIN, nextZoom);
    });
  }
  function zoomFit() { setPreviewZoom(1); }
  function zoomActual() {
    const v = videoRef.current;
    if (!v?.videoWidth || !v.parentElement) { setPreviewZoom(1); return; }
    const stage = v.parentElement;
    const fitW = Math.min(v.videoWidth, stage.clientWidth);
    setPreviewZoom(v.videoWidth / fitW);
  }

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    crop: true, silence: true, audio: true, filters: true, blackscreen: true, timelapse: true, transcription: true, style: true, templates: true,
    ...(initial.openSections ?? {}),
  });

  const [templates, setTemplates] = useState<VideoTemplate[]>(() => loadTemplates());
  const [showSaveTemplate, setShowSaveTemplate] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<string | null>(null);
  const [templateToast, setTemplateToast] = useState<string | null>(null);
  const templateToastTimerRef = useRef<number | null>(null);
  const [pendingTemplateRun, setPendingTemplateRun] = useState<{ transcribe: boolean } | null>(null);

  function flashTemplateToast(msg: string) {
    if (templateToastTimerRef.current) window.clearTimeout(templateToastTimerRef.current);
    setTemplateToast(msg);
    templateToastTimerRef.current = window.setTimeout(() => setTemplateToast(null), 2200);
  }

  function persistTemplates(next: VideoTemplate[]) {
    setTemplates(next);
    saveTemplates(next);
  }

  function saveCurrentAsTemplate() {
    const name = newTemplateName.trim();
    if (!name) { flashTemplateToast(t('templateNameRequired')); return; }
    const tpl: VideoTemplate = {
      id: newTemplateId(),
      name,
      createdAt: Date.now(),
      thresholdDb, autoThreshold, minSilenceDur,
      cropEnabled, crop, cropBgColor, aspectId, cropByZone, cropApplyToAll,
      saturation, opacity, opacityBgColor,
      blackScreenEnabled, blackScreenAspectId, blackScreenBgColor,
      style, styleByZone, styleApplyToAll,
      volumeDb, noiseGateDb, noiseGateEnabled,
      voiceCleanupEnabled, voiceCleanupIntensity,
      language, model,
      hadTranscription: !!(rawCues && rawCues.length > 0),
    };
    persistTemplates([tpl, ...templates]);
    setNewTemplateName('');
    setShowSaveTemplate(false);
    flashTemplateToast(t('templateSavedToast'));
  }

  function deleteTemplate(id: string) {
    persistTemplates(templates.filter(x => x.id !== id));
    setConfirmDeleteTemplate(null);
  }

  function applyTemplate(tpl: VideoTemplate) {
    setThresholdDb(tpl.thresholdDb);
    setAutoThreshold(tpl.autoThreshold);
    setMinSilenceDur(tpl.minSilenceDur);
    setCropEnabled(tpl.cropEnabled);
    setCrop(tpl.crop);
    setCropBgColor(tpl.cropBgColor);
    setAspectId(tpl.aspectId);
    setCropByZone(tpl.cropByZone ?? {});
    setCropApplyToAll(tpl.cropApplyToAll ?? true);
    setSaturation(typeof tpl.saturation === 'number' ? tpl.saturation : 100);
    setOpacity(typeof tpl.opacity === 'number' ? tpl.opacity : 100);
    setOpacityBgColor(tpl.opacityBgColor ?? 'black');
    setBlackScreenEnabled(tpl.blackScreenEnabled ?? false);
    setBlackScreenAspectId(tpl.blackScreenAspectId ?? DEFAULT_BLACK_SCREEN_ASPECT);
    setBlackScreenBgColor(tpl.blackScreenBgColor ?? 'black');
    setStyle(tpl.style);
    setStyleByZone(tpl.styleByZone ?? {});
    setStyleApplyToAll(tpl.styleApplyToAll);
    setVolumeDb(tpl.volumeDb);
    setNoiseGateDb(tpl.noiseGateDb);
    setNoiseGateEnabled(tpl.noiseGateEnabled);
    setVoiceCleanupEnabled(tpl.voiceCleanupEnabled ?? false);
    setVoiceCleanupIntensity(tpl.voiceCleanupIntensity ?? 'medium');
    setLanguage(tpl.language);
    setModel(tpl.model);
    flashTemplateToast(t('templateAppliedToast'));
    if (videoPath) setPendingTemplateRun({ transcribe: tpl.hadTranscription !== false });
  }
  const toggleSection = (id: string) =>
    setOpenSections(s => ({ ...s, [id]: !s[id] }));

  useEffect(() => { saveSettings({ language, model, style, openSections }); }, [language, model, style, openSections]);
  useEffect(() => { saveSettings({ openaiApiKey }); }, [openaiApiKey]);

  const cycleTheme = () => {
    onThemePrefChange(themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system');
  };

  useEffect(() => { setStorageStats(autosaveStats(videoPath)); }, [videoPath]);

  useEffect(() => {
    if (!isActive) return;
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (k === 'f5' || (ctrlOrMeta && k === 'r')) { e.preventDefault(); return; }
      if (k === 'f12') { e.preventDefault(); return; }
      if (ctrlOrMeta && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) { e.preventDefault(); return; }
      if (ctrlOrMeta && k === 'u') { e.preventDefault(); return; }
    };
    const onSelectStart = (e: Event) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const el = e.target as HTMLElement | null;
      if (el && el.isContentEditable) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey, { capture: true });
    document.addEventListener('selectstart', onSelectStart);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey, { capture: true } as any);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }, [isActive]);

  const t = (k: keyof typeof TRANSLATIONS['en']) => TRANSLATIONS[uiLang][k] ?? TRANSLATIONS.en[k];
  const tEvt = (raw: string): string => {
    if (!raw) return '';
    const m = raw.match(/evt:([A-Za-z]+\.[A-Za-z]+)(?::([0-9]+))?/);
    if (!m) return '';
    const key = m[1];
    const arg = m[2] ?? '';
    const lookup = key.startsWith('err.') ? key : `log.${key}`;
    const tbl = TRANSLATIONS[uiLang] as Record<string, string>;
    const en = TRANSLATIONS.en as Record<string, string>;
    const tpl = tbl[lookup] ?? en[lookup];
    if (!tpl) return '';
    return tpl.replace('{pct}', arg);
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, bumpVideoEl] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);
  const logStickRef = useRef(true);
  const exportCancelRef = useRef(false);
  const [cancellingExport, setCancellingExport] = useState(false);

  useEffect(() => {
    if (isActive) return;
    const v = videoRef.current;
    if (v && !v.paused) { try { v.pause(); } catch {} }
  }, [isActive]);

  const cues = useMemo(() => {
    if (!rawCues) return null;
    const hasEdits = rawCues.some(c => c.edited);
    if (wordsTs && wordsTs.length > 0 && !hasEdits) {
      return groupByWordTimestamps(wordsTs, style.maxWords);
    }
    return resegmentByWords(rawCues, style.maxWords);
  }, [rawCues, wordsTs, style.maxWords]);

  const activeCue = useMemo(() => {
    if (!cues) return null;
    return cues.find(c => currentTime >= c.start && currentTime < c.end) ?? null;
  }, [cues, currentTime]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let rafId = 0;
    const tick = () => {
      setCurrentTime(v.currentTime);
      rafId = requestAnimationFrame(tick);
    };
    const startRaf = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
    const stopRaf = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };
    const onTime = () => { if (!rafId) setCurrentTime(v.currentTime); };
    const onPlay = () => { setIsPlaying(true); startRaf(); };
    const onPause = () => { setIsPlaying(false); stopRaf(); setCurrentTime(v.currentTime); };
    const onSeeked = () => setCurrentTime(v.currentTime);
    const onMeta = () => {
      if (v.duration && isFinite(v.duration)) setVideoDuration(d => d || v.duration);
      const p = pendingPlaybackRef.current;
      if (p) {
        try {
          if (typeof p.volume === 'number') v.volume = Math.max(0, Math.min(1, p.volume));
          if (typeof p.muted === 'boolean') v.muted = p.muted;
          if (typeof p.playbackRate === 'number') v.playbackRate = p.playbackRate;
          if (typeof p.currentTime === 'number' && isFinite(p.currentTime)) {
            const t = Math.max(0, Math.min((v.duration || p.currentTime + 1) - 0.05, p.currentTime));
            v.currentTime = t;
          }
        } catch {}
        pendingPlaybackRef.current = null;
      }
    };
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('volumechange', onVol);
    if (!v.paused) startRaf();
    return () => {
      stopRaf();
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('volumechange', onVol);
    };
  }, [videoUrl]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = effectiveSpeed * previewSpeed;
  }, [effectiveSpeed, previewSpeed, videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const ensure = () => {
      if (audioCtxRef.current) return;
      try {
        const Ctx: typeof AudioContext | undefined =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const src = ctx.createMediaElementSource(v);
        const gateGain = ctx.createGain();
        const volGain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        src.connect(gateGain);
        gateGain.connect(volGain);
        volGain.connect(ctx.destination);
        volGain.gain.value = Math.pow(10, volumeDb / 20);
        gateGain.gain.value = 1;
        audioCtxRef.current = ctx;
        audioSourceRef.current = src;
        audioGainRef.current = volGain;
        audioGateRef.current = gateGain;
        audioAnalyserRef.current = analyser;
        audioGateBufferRef.current = new Float32Array(analyser.fftSize);
      } catch { /* preview falls back to raw element audio */ }
    };
    const onPlay = () => {
      ensure();
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    v.addEventListener('play', onPlay);
    return () => {
      v.removeEventListener('play', onPlay);
      const ctx = audioCtxRef.current;
      if (ctx) {
        try { ctx.close(); } catch {}
      }
      audioCtxRef.current = null;
      audioSourceRef.current = null;
      audioGainRef.current = null;
      audioGateRef.current = null;
      audioAnalyserRef.current = null;
      audioGateBufferRef.current = null;
    };
  }, [videoUrl]);

  useEffect(() => {
    const g = audioGainRef.current;
    const ctx = audioCtxRef.current;
    if (!g || !ctx) return;
    const lin = Math.pow(10, volumeDb / 20);
    g.gain.setTargetAtTime(lin, ctx.currentTime, 0.02);
  }, [volumeDb]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    const gate = audioGateRef.current;
    if (!noiseGateEnabled) {
      if (gate && ctx) gate.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
      if (audioGateRafRef.current != null) {
        cancelAnimationFrame(audioGateRafRef.current);
        audioGateRafRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const c = audioCtxRef.current;
      const an = audioAnalyserRef.current;
      const g = audioGateRef.current;
      const buf = audioGateBufferRef.current;
      if (c && an && g && buf) {
        an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const thr = Math.pow(10, noiseGateDb / 20);
        const open = rms > thr;
        g.gain.setTargetAtTime(open ? 1 : 0, c.currentTime, open ? 0.005 : 0.04);
      }
      audioGateRafRef.current = requestAnimationFrame(tick);
    };
    audioGateRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (audioGateRafRef.current != null) {
        cancelAnimationFrame(audioGateRafRef.current);
        audioGateRafRef.current = null;
      }
    };
  }, [noiseGateEnabled, noiseGateDb]);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (videoUrl) {
      if (pv.src !== videoUrl) pv.src = videoUrl;
      pv.muted = true;
      try { pv.load(); } catch {}
    } else {
      try { pv.removeAttribute('src'); pv.load(); } catch {}
    }
  }, [videoUrl]);

  async function loadBgAudioFromPath(picked: string) {
    if (!picked) return;
    setBgAudioLoading(true);
    try {
      const res = await window.subbi.extractPeaks({ videoPath: picked, targetBins: 4000, binsPerSecond: 40 });
      const duration = res.duration > 0 ? res.duration : 0;
      if (!duration) {
        setProc({ phase: 'error', message: t('bgAudioInvalid') });
        return;
      }
      setBgAudio({
        path: picked,
        url: 'file:///' + picked.replace(/\\/g, '/'),
        duration,
        peaks: res.peaks,
        offset: 0,
        inPoint: 0,
        outPoint: duration,
        volumeDb: 0,
        muted: false,
      });
    } catch {
      setProc({ phase: 'error', message: t('bgAudioInvalid') });
    } finally {
      setBgAudioLoading(false);
    }
  }

  async function importBgAudio() {
    const picked = await window.subbi.pickAudio?.();
    if (!picked) return;
    await loadBgAudioFromPath(picked);
  }

  function handleBgAudioDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) {
      const p = window.subbi.getPathForFile?.(f) || '';
      if (p && isAudioPath(p)) {
        loadBgAudioFromPath(p);
        return;
      }
    }
    setProc({ phase: 'error', message: t('bgAudioInvalid') });
  }

  function updateBgAudio(patch: Partial<BgAudioState>) {
    setBgAudio(prev => (prev ? { ...prev, ...patch } : prev));
  }

  function removeBgAudio() {
    setBgAudio(null);
  }

  useEffect(() => {
    const a = bgAudioRef.current;
    if (!a || !bgAudio) return;
    a.volume = Math.max(0, Math.min(1, Math.pow(10, bgAudio.volumeDb / 20)));
    a.muted = bgAudio.muted;
  }, [bgAudio?.volumeDb, bgAudio?.muted]);

  useEffect(() => {
    const a = bgAudioRef.current;
    const v = videoRef.current;
    if (!a || !v || !bgAudio) return;
    a.playbackRate = v.playbackRate || 1;
    const clipLen = Math.max(0, bgAudio.outPoint - bgAudio.inPoint);

    const computeBgTime = (videoTime: number) => bgAudio.inPoint + (videoTime - bgAudio.offset);

    const syncTime = () => {
      const want = computeBgTime(v.currentTime);
      const inRange = v.currentTime >= bgAudio.offset && v.currentTime < bgAudio.offset + clipLen;
      if (!inRange) {
        if (!a.paused) a.pause();
        return;
      }
      if (Math.abs(a.currentTime - want) > 0.15) {
        try { a.currentTime = Math.max(0, Math.min(bgAudio.outPoint - 0.001, want)); } catch {}
      }
      if (!v.paused && a.paused) {
        a.play().catch(() => {});
      } else if (v.paused && !a.paused) {
        a.pause();
      }
    };

    const onPlay = () => syncTime();
    const onPause = () => { try { a.pause(); } catch {} };
    const onSeeked = () => syncTime();
    const onSeeking = () => { try { a.pause(); } catch {} };
    const onRate = () => { a.playbackRate = v.playbackRate || 1; };
    const onTime = () => {
      const inRange = v.currentTime >= bgAudio.offset && v.currentTime < bgAudio.offset + clipLen;
      if (!inRange) {
        if (!a.paused) a.pause();
        return;
      }
      if (v.paused) return;
      if (a.paused) {
        try { a.currentTime = Math.max(0, Math.min(bgAudio.outPoint - 0.001, computeBgTime(v.currentTime))); } catch {}
        a.play().catch(() => {});
      } else {
        const want = computeBgTime(v.currentTime);
        if (Math.abs(a.currentTime - want) > 0.3) {
          try { a.currentTime = Math.max(0, Math.min(bgAudio.outPoint - 0.001, want)); } catch {}
        }
      }
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('timeupdate', onTime);
    syncTime();
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('timeupdate', onTime);
      try { a.pause(); } catch {}
    };
  }, [bgAudio?.url, bgAudio?.offset, bgAudio?.inPoint, bgAudio?.outPoint, videoUrl]);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv || !hoverPreview) return;
    const t = Math.max(0, Math.min((pv.duration || hoverPreview.time + 1) - 0.05, hoverPreview.time));
    if (Math.abs(pv.currentTime - t) > 0.05) {
      try { pv.currentTime = t; } catch {}
    }
  }, [hoverPreview]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const update = () => setScrollViewportW(el.clientWidth || 0);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [videoUrl]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    const dur = videoDuration;
    const prev = lastZoomRef.current;
    lastZoomRef.current = timelineZoom;
    if (!el || !dur || prev === timelineZoom) return;
    const viewport = el.clientWidth;
    const innerWidth = viewport * timelineZoom;
    const cursorX = (currentTime / dur) * innerWidth;
    const target = Math.max(0, Math.min(innerWidth - viewport, cursorX - viewport / 2));
    el.scrollLeft = target;
  }, [timelineZoom, videoDuration, currentTime]);

  useEffect(() => {
    if (!isActive) return;
    function onKey(e: KeyboardEvent) {
      if (!videoUrl) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'm' || e.key === 'M') {
        const v = videoRef.current; if (v) v.muted = !v.muted;
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((videoRef.current?.currentTime ?? 0) - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((videoRef.current?.currentTime ?? 0) + 5); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); zoomFit(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoUrl, videoDuration, isActive]);
  function seekTo(time: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(videoDuration || time, time));
  }

  useEffect(() => {
    const off = window.subbi.onProgress((evt) => {
      if (evt.jobId && !evt.jobId.startsWith(tabId + ':')) return;
      const msg = tEvt(evt.line);
      if (evt.kind === 'transcribe') {
        setProc(p => p.phase === 'transcribing'
          ? { phase: 'transcribing', pct: evt.pct, log: msg ? (p.log + msg + '\n').slice(-2000) : p.log } : p);
      } else if (evt.kind === 'export') {
        setProc(p => p.phase === 'exporting'
          ? { phase: 'exporting', pct: evt.pct, log: msg ? (p.log + msg + '\n').slice(-2000) : p.log } : p);
      } else if (evt.kind === 'modelDownload') {
        setModelStatus(s => ({ ...s, [evt.model]: { phase: 'downloading', pct: evt.pct } }));
      } else if (evt.kind === 'vcPreview') {
        setVcPreviewPct(evt.pct);
      }
    });
    return off;
  }, [uiLang, tabId]);

  useEffect(() => {
    if (!openSections.transcription) return;
    if (model === 'cloud') return;
    const { whisper } = modelToBackend(model);
    setModelStatus(s => {
      const cur = s[whisper];
      if (cur.phase === 'downloading' || cur.phase === 'present' || cur.phase === 'checking') return s;
      return { ...s, [whisper]: { phase: 'checking' } };
    });
    let cancelled = false;
    (async () => {
      try {
        const present = await window.subbi.checkModel(whisper);
        if (cancelled) return;
        if (present) {
          setModelStatus(s => ({ ...s, [whisper]: { phase: 'present' } }));
          return;
        }
        setModelStatus(s => ({ ...s, [whisper]: { phase: 'downloading', pct: 0 } }));
        await window.subbi.downloadModel(whisper, `${tabId}:modelDownload:${whisper}`);
        if (cancelled) return;
        setModelStatus(s => ({ ...s, [whisper]: { phase: 'present', pct: 100 } }));
      } catch (err: any) {
        if (cancelled) return;
        const raw = String(err?.message || err);
        setModelStatus(s => ({ ...s, [whisper]: { phase: 'error', error: tEvt(raw) || raw } }));
      }
    })();
    return () => { cancelled = true; };
  }, [model, openSections.transcription]);

  const logText = (proc.phase === 'transcribing' || proc.phase === 'exporting') ? proc.log : '';
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (logStickRef.current) el.scrollTop = el.scrollHeight;
  }, [logText]);

  const justLoadedRef = useRef(false);
  const pendingPlaybackRef = useRef<{ currentTime?: number; volume?: number; muted?: boolean; playbackRate?: number } | null>(null);
  const [autosaveTick, setAutosaveTick] = useState<'idle' | 'saved'>('idle');
  const [storageStats, setStorageStats] = useState<{ total: number; others: number; count: number; othersCount: number }>(
    () => autosaveStats(null)
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!initialVideoPath) return;
      const exists = await window.subbi.pathExists?.(initialVideoPath).catch(() => false);
      if (cancelled) return;
      if (exists) loadVideo(initialVideoPath);
      else onVideoPathChange(null);
    })();
    return () => { cancelled = true; };
  }, []);

  function loadVideo(filePath: string) {
    if (videoPath && videoPath !== filePath) {
      saveProject(videoPath, {
        silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
        cropEnabled, crop, cropBgColor, aspectId, saturation, opacity, opacityBgColor,
        blackScreenEnabled, blackScreenAspectId, blackScreenBgColor,
        volumeDb, noiseGateDb, noiseGateEnabled,
        voiceCleanupEnabled, voiceCleanupIntensity,
        srtPath, rawCues, wordsTs, style, language, model,
        splitMarkers, cropByZone, cropApplyToAll, styleByZone, styleApplyToAll, subtitlesEnabled, excludedSegments,
        currentTime, timelineZoom, previewZoom, volume, muted, playbackRate,
        timelapseEnabled, timelapseTargetSec, timelapseMuteOriginal,
        bgAudio: bgAudio ? bgAudioToPersist(bgAudio) : null,
      });
    }
    setVideoPath(filePath);
    setVideoUrl('file:///' + filePath.replace(/\\/g, '/'));
    setProc({ phase: 'idle' });
    setVideoDuration(0);
    setPeaks(null);
    onVideoPathChange(filePath);

    const saved = loadProject(filePath);
    justLoadedRef.current = true;
    if (saved) {
      setSilenceRegions(saved.silenceRegions ?? []);
      setThresholdDb(saved.thresholdDb ?? -30);
      setAutoThreshold(saved.autoThreshold ?? true);
      setMeanVolumeDb(saved.meanVolumeDb ?? null);
      setMinSilenceDur(saved.minSilenceDur ?? 0.5);
      setCropEnabled(saved.cropEnabled ?? false);
      setCrop(saved.crop ?? DEFAULT_CROP);
      setCropBgColor(saved.cropBgColor ?? 'black');
      setAspectId(saved.aspectId ?? 'free');
      setSaturation(typeof saved.saturation === 'number' ? saved.saturation : 100);
      setOpacity(typeof saved.opacity === 'number' ? saved.opacity : 100);
      setOpacityBgColor(saved.opacityBgColor ?? 'black');
      setBlackScreenEnabled(saved.blackScreenEnabled ?? false);
      setBlackScreenAspectId(saved.blackScreenAspectId ?? DEFAULT_BLACK_SCREEN_ASPECT);
      setBlackScreenBgColor(saved.blackScreenBgColor ?? 'black');
      setVolumeDb(saved.volumeDb ?? 0);
      setNoiseGateDb(saved.noiseGateDb ?? -40);
      setNoiseGateEnabled(saved.noiseGateEnabled ?? false);
      setVoiceCleanupEnabled(saved.voiceCleanupEnabled ?? false);
      setVoiceCleanupIntensity(saved.voiceCleanupIntensity ?? 'medium');
      setSrtPath(saved.srtPath ?? null);
      setRawCues(saved.rawCues ?? null);
      setWordsTs(saved.wordsTs ?? null);
      setSplitMarkers(saved.splitMarkers ?? []);
      setCropByZone(saved.cropByZone ?? {});
      setCropApplyToAll(saved.cropApplyToAll ?? true);
      setStyleByZone(saved.styleByZone ?? {});
      setStyleApplyToAll(saved.styleApplyToAll ?? true);
      setSubtitlesEnabled(saved.subtitlesEnabled ?? true);
      setExcludedSegments(saved.excludedSegments ?? {});
      if (saved.style) setStyle({ ...DEFAULT_STYLE, ...saved.style });
      if (saved.language) setLanguage(saved.language);
      if (saved.model) setModel(normalizeModel(saved.model));
      if (typeof saved.timelineZoom === 'number') setTimelineZoom(saved.timelineZoom);
      if (typeof saved.previewZoom === 'number') setPreviewZoom(saved.previewZoom);
      if (typeof saved.currentTime === 'number') setCurrentTime(saved.currentTime);
      if (typeof saved.volume === 'number') setVolume(saved.volume);
      if (typeof saved.muted === 'boolean') setMuted(saved.muted);
      if (typeof saved.playbackRate === 'number') setPlaybackRate(saved.playbackRate);
      setTimelapseEnabled(!!saved.timelapseEnabled);
      if (typeof saved.timelapseTargetSec === 'number' && saved.timelapseTargetSec > 0) setTimelapseTargetSec(saved.timelapseTargetSec);
      else setTimelapseTargetSec(60);
      setTimelapseMuteOriginal(saved.timelapseMuteOriginal ?? true);
      pendingPlaybackRef.current = {
        currentTime: saved.currentTime,
        volume: saved.volume,
        muted: saved.muted,
        playbackRate: saved.playbackRate,
      };
      if (saved.bgAudio) {
        setBgAudio({
          ...saved.bgAudio,
          url: 'file:///' + saved.bgAudio.path.replace(/\\/g, '/'),
        });
      } else {
        setBgAudio(null);
      }
    } else {
      setSilenceRegions([]);
      setMeanVolumeDb(null);
      setSrtPath(null);
      setRawCues(null);
      setWordsTs(null);
      setCropEnabled(false);
      setCrop(DEFAULT_CROP);
      setCropBgColor('black');
      setAspectId('free');
      setSaturation(100);
      setOpacity(100);
      setOpacityBgColor('black');
      setBlackScreenEnabled(false);
      setBlackScreenAspectId(DEFAULT_BLACK_SCREEN_ASPECT);
      setBlackScreenBgColor('black');
      setVolumeDb(0);
      setNoiseGateDb(-40);
      setNoiseGateEnabled(false);
      setSplitMarkers([]);
      setCropByZone({});
      setCropApplyToAll(true);
      setStyleByZone({});
      setStyleApplyToAll(true);
      setSubtitlesEnabled(true);
      setExcludedSegments({});
      setCurrentTime(0);
      setTimelineZoom(1);
      setPreviewZoom(1);
      setTimelapseEnabled(false);
      setTimelapseTargetSec(60);
      setTimelapseMuteOriginal(true);
      pendingPlaybackRef.current = null;
      setBgAudio(null);
    }
    setSelectedMarker(null);
  }

  const savePayloadRef = useRef<{ path: string; state: ProjectState } | null>(null);
  useEffect(() => {
    if (!videoPath) { savePayloadRef.current = null; return; }
    savePayloadRef.current = {
      path: videoPath,
      state: {
        silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
        cropEnabled, crop, cropBgColor, aspectId, saturation, opacity, opacityBgColor,
        blackScreenEnabled, blackScreenAspectId, blackScreenBgColor,
        volumeDb, noiseGateDb, noiseGateEnabled,
        voiceCleanupEnabled, voiceCleanupIntensity,
        srtPath, rawCues, wordsTs, style, language, model,
        splitMarkers, cropByZone, cropApplyToAll, styleByZone, styleApplyToAll, subtitlesEnabled, excludedSegments,
        currentTime, timelineZoom, previewZoom, volume, muted, playbackRate,
        timelapseEnabled, timelapseTargetSec, timelapseMuteOriginal,
        bgAudio: bgAudio ? bgAudioToPersist(bgAudio) : null,
      },
    };
  });

  useEffect(() => {
    if (!videoPath) return;
    if (justLoadedRef.current) { justLoadedRef.current = false; return; }
    const handle = setTimeout(() => {
      const p = savePayloadRef.current;
      if (p) saveProject(p.path, p.state);
      setAutosaveTick('saved');
      setStorageStats(autosaveStats(videoPath));
      const t = setTimeout(() => setAutosaveTick('idle'), 1200);
      return () => clearTimeout(t);
    }, 400);
    return () => clearTimeout(handle);
  }, [videoPath, silenceRegions, thresholdDb, autoThreshold, meanVolumeDb, minSilenceDur,
      cropEnabled, crop, cropBgColor, aspectId, saturation, opacity, opacityBgColor,
      blackScreenEnabled, blackScreenAspectId, blackScreenBgColor,
      volumeDb, noiseGateDb, noiseGateEnabled,
      voiceCleanupEnabled, voiceCleanupIntensity,
      srtPath, rawCues, style, language, model,
      splitMarkers, cropByZone, cropApplyToAll, styleByZone, styleApplyToAll, subtitlesEnabled, excludedSegments,
      currentTime, timelineZoom, previewZoom, volume, muted, playbackRate,
      timelapseEnabled, timelapseTargetSec, timelapseMuteOriginal, bgAudio]);

  useEffect(() => {
    return () => {
      const p = savePayloadRef.current;
      if (p) saveProject(p.path, p.state);
    };
  }, []);

  useEffect(() => {
    if (!videoPath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.subbi.extractPeaks({ videoPath, targetBins: 2000, binsPerSecond: 40 });
        if (cancelled) return;
        setPeaks(res.peaks);
        setVideoDuration(d => d || res.duration);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [videoPath]);

  useEffect(() => { if (videoUrl && videoRef.current) bumpVideoEl(n => n + 1); }, [videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.paused || silenceRegions.length === 0) return;
    for (const r of silenceRegions) {
      if (!r.enabled) continue;
      if (currentTime >= r.start && currentTime < r.end - 0.02) {
        const target = Math.min(r.end, (videoDuration || r.end) - 0.001);
        if (target > v.currentTime) v.currentTime = target;
        break;
      }
    }
  }, [currentTime, silenceRegions, videoDuration]);

  async function detectSilencesNow() {
    if (!videoPath) return;
    setProc({ phase: 'detecting' });
    try {
      const res = await window.subbi.detectSilences({
        videoPath,
        thresholdDb: autoThreshold ? undefined : thresholdDb,
        minDurSec: minSilenceDur,
      });
      setMeanVolumeDb(res.meanVolumeDb);
      setVideoDuration(res.duration);
      if (autoThreshold) setThresholdDb(Math.round(res.thresholdDb));
      setSilenceRegions(prev => {
        const manual = prev.filter(r => r.manual);
        const detected = res.silences.map((s, i) => ({
          id: `sil-${i}-${s.start.toFixed(3)}`,
          start: s.start, end: s.end, enabled: true,
        }));
        return [...detected, ...manual];
      });
      setProc({ phase: 'idle' });
    } catch (err: any) {
      setProc({ phase: 'error', message: tEvt(String(err?.message || err)) || String(err?.message || err) });
    }
  }

  function toggleSilence(id: string) {
    setSilenceRegions(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }
  function updateSilence(id: string, start: number, end: number) {
    setSilenceRegions(rs => rs.map(r => r.id === id ? { ...r, start, end } : r));
  }
  function removeSilence(id: string) {
    setSilenceRegions(rs => rs.filter(r => r.id !== id));
  }
  function addManualExclusion() {
    if (!videoDuration) return;
    const start = Math.max(0, Math.min(currentTime, videoDuration - 0.1));
    const end = Math.min(videoDuration, start + 1);
    if (end - start < 0.05) return;
    const id = `man-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setSilenceRegions(rs => [...rs, { id, start, end, enabled: true, manual: true }]);
  }

  function buildKeepRanges(): { start: number; end: number }[] {
    if (!videoDuration) return [];
    const cuts = silenceRegions.filter(r => r.enabled).map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    const keep: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const c of cuts) {
      if (c.start > cursor) keep.push({ start: cursor, end: Math.min(c.start, videoDuration) });
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < videoDuration) keep.push({ start: cursor, end: videoDuration });
    return keep.filter(k => k.end - k.start > 0.02);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const paths: string[] = [];
    for (const f of files) {
      const p = window.subbi.getPathForFile?.(f) || (f as any).path || '';
      if (p) paths.push(p);
    }
    if (paths.length === 0) { setProc({ phase: 'error', message: t('couldNotReadPath') }); return; }
    const videoPaths = paths.filter(isVideoPath);
    if (videoPaths.length === 0) { setProc({ phase: 'error', message: t('notAVideo') }); return; }
    if (onDropPaths && onDropPaths(videoPaths)) return;
    loadVideo(videoPaths[0]);
  }

  async function pickFile() {
    const p = await window.subbi.pickVideo();
    if (p) loadVideo(p);
  }

  async function transcribe() {
    if (!videoPath) return;
    const { engine, whisper } = modelToBackend(model);
    if (engine === 'openai' && !openaiApiKey.trim()) {
      setProc({ phase: 'error', message: tEvt('evt:err.openaiKeyMissing') || t('openaiKeyMissing') });
      return;
    }
    logStickRef.current = true;
    setProc({ phase: 'transcribing', pct: 0, log: '' });
    try {
      const r = await window.subbi.transcribe({
        videoPath,
        language,
        model: whisper,
        engine,
        apiKey: engine === 'openai' ? openaiApiKey.trim() : undefined,
      }, `${tabId}:transcribe`);
      setSrtPath(r.srtPath);
      setRawCues(parseSrt(r.srt));
      setWordsTs(r.words && r.words.length > 0 ? r.words : null);
      setProc({ phase: 'idle' });
    } catch (err: any) {
      setProc({ phase: 'error', message: tEvt(String(err?.message || err)) || String(err?.message || err) });
    }
  }

  useEffect(() => {
    if (!pendingTemplateRun) return;
    if (!videoPath) { setPendingTemplateRun(null); return; }
    const shouldTranscribe = pendingTemplateRun.transcribe;
    setPendingTemplateRun(null);
    (async () => {
      try { await detectSilencesNow(); } catch {}
      if (shouldTranscribe) { try { await transcribe(); } catch {} }
    })();
  }, [pendingTemplateRun, videoPath]);

  const enabledCount = silenceRegions.filter(r => r.enabled).length;
  const totalCutSec = silenceRegions.filter(r => r.enabled).reduce((s, r) => s + (r.end - r.start), 0);

  async function exportNow() {
    if (!videoPath) return;
    const hasSilence = enabledCount > 0;
    const hasSubs = !!(subtitlesEnabled && srtPath && cues && cues.length > 0);
    const hasCrop = cropEnabled;
    const hasVolume = Math.abs(volumeDb) > 0.01;
    const hasGate = noiseGateEnabled && noiseGateDb < -0.01;
    const hasVoiceCleanup = voiceCleanupEnabled;
    const hasSplits = splitMarkers.length > 0;
    const hasBlackScreen = blackScreenEnabled;
    const hasSaturation = !hasBlackScreen && Math.abs(saturation - 100) > 0.5;
    const hasOpacity = !hasBlackScreen && opacity < 99.5;
    const hasBgAudio = !!bgAudio && !bgAudio.muted && (bgAudio.outPoint - bgAudio.inPoint) > 0.02;
    if (!hasSilence && !hasSubs && !hasCrop && !hasVolume && !hasGate && !hasVoiceCleanup && !hasSplits && !hasSaturation && !hasOpacity && !hasBgAudio && !hasBlackScreen) {
      setProc({ phase: 'error', message: t('nothingToExport') });
      return;
    }

    const cuts = [...splitMarkers].sort((a, b) => a - b);
    const segmentBounds: { start: number; end: number }[] = [];
    let prev = 0;
    for (const c of cuts) {
      if (c > prev + 0.02) segmentBounds.push({ start: prev, end: c });
      prev = c;
    }
    if (videoDuration > prev + 0.02) segmentBounds.push({ start: prev, end: videoDuration });
    if (segmentBounds.length === 0) segmentBounds.push({ start: 0, end: videoDuration });
    const includedBounds = segmentBounds.filter(seg => !excludedSegments[seg.start.toFixed(3)]);
    if (includedBounds.length === 0) {
      setProc({ phase: 'error', message: t('nothingToExport') });
      return;
    }

    const baseKeep = hasSilence ? buildKeepRanges() : null;
    function rangesForSegment(seg: { start: number; end: number }) {
      if (!baseKeep) return [{ start: seg.start, end: seg.end }];
      return baseKeep
        .map(r => ({ start: Math.max(r.start, seg.start), end: Math.min(r.end, seg.end) }))
        .filter(r => r.end - r.start > 0.02);
    }

    const sep = videoPath.includes('\\') ? '\\' : '/';
    const dir = videoPath.substring(0, videoPath.lastIndexOf(sep));
    const file = videoPath.substring(videoPath.lastIndexOf(sep) + 1);
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.substring(0, dot) : file;
    const ext = dot > 0 ? file.substring(dot) : '.mp4';
    const multi = includedBounds.length > 1;

    logStickRef.current = true;
    exportCancelRef.current = false;
    setCancellingExport(false);
    setProc({ phase: 'exporting', pct: 0, log: '' });
    try {
      const outputs: string[] = [];
      let burnSrtPath = srtPath;
      const useWordAlignedSrt = hasSubs && wordsTs && wordsTs.length > 0 && !!cues;
      if (useWordAlignedSrt && srtPath) {
        const alignedPath = srtPath.replace(/\.srt$/i, '') + '.aligned.srt';
        try {
          await window.subbi.writeSrt({ srtPath: alignedPath, content: formatSrt(cues!) });
          burnSrtPath = alignedPath;
        } catch {}
      }
      const total = includedBounds.length;
      for (let i = 0; i < total; i++) {
        if (exportCancelRef.current) throw new Error('evt:export.cancelled');
        const seg = includedBounds[i];
        const segKeep = rangesForSegment(seg);
        if (segKeep.length === 0) continue;
        const segLabel = t('log.export.segment')
          .replace('{n}', String(i + 1))
          .replace('{total}', String(total));
        setProc(p => p.phase === 'exporting'
          ? { ...p, log: (p.log + segLabel + '\n').slice(-2000) }
          : p);
        const useKeep = hasSilence || multi;
        const outName = multi ? `${base}.subbi.${i + 1}${ext}` : `${base}.subbi${ext}`;
        const outputPath = `${dir}${sep}${outName}`;
        const hasEditedCues = !!(rawCues && rawCues.some(c => c.edited));
        const segStyle = styleForTime(seg.start);
        const burnStyle = (hasEditedCues || useWordAlignedSrt) ? { ...segStyle, maxWords: 0 } : segStyle;
        let segBg: SubbiBgAudioExport | null = null;
        if (hasBgAudio && bgAudio) {
          const clipStartInVideo = bgAudio.offset;
          const clipEndInVideo = bgAudio.offset + (bgAudio.outPoint - bgAudio.inPoint);
          const overlapStart = Math.max(seg.start, clipStartInVideo);
          const overlapEnd = Math.min(seg.end, clipEndInVideo);
          if (overlapEnd - overlapStart > 0.02) {
            const mapToOutput = (tAbs: number): number => {
              if (!useKeep || segKeep.length === 0) return Math.max(0, tAbs - seg.start);
              let acc = 0;
              for (const r of segKeep) {
                if (tAbs < r.start) return acc;
                if (tAbs < r.end) return acc + (tAbs - r.start);
                acc += r.end - r.start;
              }
              return acc;
            };
            const outOffset = mapToOutput(overlapStart);
            segBg = {
              path: bgAudio.path,
              offset: outOffset,
              inPoint: bgAudio.inPoint + Math.max(0, overlapStart - clipStartInVideo),
              outPoint: bgAudio.inPoint + (overlapEnd - clipStartInVideo),
              volumeDb: bgAudio.volumeDb,
            };
          }
        }
        const bsPreset = BLACK_SCREEN_PRESETS.find(p => p.id === blackScreenAspectId) ?? BLACK_SCREEN_PRESETS[0];
        const segOut = await window.subbi.exportVideo({
          videoPath,
          keepRanges: useKeep ? segKeep : undefined,
          crop: hasCrop && !hasBlackScreen ? cropForTime(seg.start) : null,
          cropBgColor: hasCrop && !hasBlackScreen ? cropBgColor : undefined,
          blackScreen: hasBlackScreen
            ? { width: bsPreset.w, height: bsPreset.h, color: blackScreenBgColor }
            : null,
          subtitles: hasSubs ? { srtPath: burnSrtPath!, style: burnStyle } : null,
          volumeDb: hasVolume ? volumeDb : 0,
          noiseGateDb: hasGate ? noiseGateDb : null,
          voiceCleanup: hasVoiceCleanup ? { enabled: true, intensity: voiceCleanupIntensity } : null,
          saturation: hasSaturation ? saturation : 100,
          opacity: hasOpacity ? opacity : 100,
          opacityBgColor: hasOpacity ? opacityBgColor : undefined,
          speed: effectiveSpeed !== 1 ? effectiveSpeed : undefined,
          muteOriginal: timelapseEnabled && timelapseMuteOriginal ? true : undefined,
          outputPath,
          videoWidth: videoW || undefined,
          videoHeight: videoH || undefined,
          bgAudio: segBg,
        }, `${tabId}:export`);
        outputs.push(segOut);
        setProc(p => p.phase === 'exporting'
          ? { ...p, pct: Math.min(100, ((i + 1) / total) * 100) }
          : p);
      }
      setProc({ phase: 'exported', outPath: multi ? `${outputs.length} files in ${dir}` : outputs[0] });
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (raw.includes('evt:export.cancelled') || exportCancelRef.current) {
        setProc({ phase: 'error', message: t('exportCancelled') });
      } else {
        setProc({ phase: 'error', message: tEvt(raw) || raw });
      }
    } finally {
      exportCancelRef.current = false;
      setCancellingExport(false);
    }
  }

  function cancelExportNow() {
    exportCancelRef.current = true;
    setCancellingExport(true);
    try { window.subbi.cancelExport?.(`${tabId}:export`); } catch {}
  }

  const _videoNativeW = videoRef.current?.videoWidth ?? 0;
  const _videoNativeH = videoRef.current?.videoHeight ?? 0;
  const bsPreset = blackScreenEnabled
    ? (BLACK_SCREEN_PRESETS.find(p => p.id === blackScreenAspectId) ?? BLACK_SCREEN_PRESETS[0])
    : null;
  const bsFit = (() => {
    if (!bsPreset || stageSize.w <= 0 || stageSize.h <= 0) return null;
    const a = bsPreset.w / bsPreset.h;
    const stageA = stageSize.w / stageSize.h;
    return a > stageA
      ? { w: stageSize.w, h: stageSize.w / a }
      : { w: stageSize.h * a, h: stageSize.h };
  })();
  const previewDisplayScale = (() => {
    if (bsPreset) return bsFit ? bsFit.w / bsPreset.w : 1;
    if (!_videoNativeW || !_videoNativeH) return previewZoom;
    if (previewZoom !== 1) return previewZoom;
    if (stageSize.w <= 0 || stageSize.h <= 0) return 1;
    return Math.min(stageSize.w / _videoNativeW, stageSize.h / _videoNativeH);
  })();
  const displayedVideoW = bsFit ? bsFit.w : _videoNativeW * previewDisplayScale;
  const overlayStyle: React.CSSProperties = {
    bottom: `${effectiveStyle.marginVPct}%`,
    left: '50%',
    width: displayedVideoW > 0 ? `${displayedVideoW}px` : `${100 - 2 * Math.abs(effectiveStyle.marginHPct)}%`,
    transform: `translateX(calc(-50% + ${effectiveStyle.marginHPct}%))`,
    fontFamily: effectiveStyle.fontName,
    fontSize: `${effectiveStyle.fontSize * previewDisplayScale}px`,
    color: effectiveStyle.color,
    fontWeight: effectiveStyle.fontWeight === 'bold' ? 700 : effectiveStyle.fontWeight === 'semibold' ? 600 : 400,
    ['--outline' as any]: effectiveStyle.outlineEnabled ? effectiveStyle.outline : 'transparent',
    textShadow: effectiveStyle.outlineEnabled
      ? (() => {
          const w = Math.max(0, (effectiveStyle.outlineWidth ?? 2) * previewDisplayScale);
          const c = effectiveStyle.outline;
          return `-${w}px -${w}px 0 ${c}, ${w}px -${w}px 0 ${c}, -${w}px ${w}px 0 ${c}, ${w}px ${w}px 0 ${c}`;
        })()
      : 'none',
  };

  function beginEditCue() {
    if (!activeCue) return;
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setEditingCue(activeCue);
    setEditingText(activeCue.text);
  }

  function cancelEditCue() {
    setEditingCue(null);
    setEditingText('');
  }

  function commitEditCue() {
    if (!editingCue) return;
    const target = editingCue;
    const newText = editingText.replace(/\s+$/g, '');
    if (!newText.trim() || newText === target.text || !rawCues) {
      cancelEditCue();
      return;
    }
    const source: Cue[] = (wordsTs && wordsTs.length > 0)
      ? (cues ?? resegmentByWords(rawCues, style.maxWords))
      : resegmentByWords(rawCues, style.maxWords);
    const updated = source.map(c =>
      Math.abs(c.start - target.start) < 1e-6 && Math.abs(c.end - target.end) < 1e-6
        ? { ...c, text: newText, edited: true }
        : c
    );
    setRawCues(updated);
    if (srtPath) {
      window.subbi.writeSrt({ srtPath, content: formatSrt(updated) }).catch(() => {});
    }
    cancelEditCue();
  }

  const previewText = activeCue
    ? applyCase(activeCue.text, effectiveStyle.textCase)
    : applyCase(t('sampleSubtitle'), effectiveStyle.textCase);

  const isBusy = proc.phase === 'transcribing' || proc.phase === 'detecting' || proc.phase === 'exporting';
  const isEditBusy = proc.phase === 'exporting';
  const isSilenceBusy = proc.phase === 'detecting' || proc.phase === 'exporting';

  const aspectRatio = ASPECT_PRESETS.find(a => a.id === aspectId)?.ratio ?? null;

  const videoW = videoRef.current?.videoWidth ?? 0;
  const videoH = videoRef.current?.videoHeight ?? 0;
  const cropPxX = videoW ? Math.round(effectiveCrop.x * videoW) : 0;
  const cropPxY = videoH ? Math.round(effectiveCrop.y * videoH) : 0;
  const cropPxW = videoW ? Math.round(effectiveCrop.width * videoW) : 0;
  const cropPxH = videoH ? Math.round(effectiveCrop.height * videoH) : 0;

  function updateCropFromPixels(p: { x?: number; y?: number; w?: number; h?: number }) {
    if (!videoW || !videoH) return;
    if (!isFinite(p.x ?? 0) || !isFinite(p.y ?? 0) || !isFinite(p.w ?? 0) || !isFinite(p.h ?? 0)) return;
    setEffectiveCrop(cur => {
      const next = { ...cur };
      if (p.x != null) next.x = Math.max(0, Math.min(videoW - 1, p.x)) / videoW;
      if (p.y != null) next.y = Math.max(0, Math.min(videoH - 1, p.y)) / videoH;
      if (p.w != null) next.width = Math.max(1, Math.min(videoW, p.w)) / videoW;
      if (p.h != null) next.height = Math.max(1, Math.min(videoH, p.h)) / videoH;
      if (next.x + next.width > 1) next.x = Math.max(0, 1 - next.width);
      if (next.y + next.height > 1) next.y = Math.max(0, 1 - next.height);
      return next;
    });
    setAspectId('free');
    setCropEnabled(true);
    setCropEditing(true);
  }

  function applyCropFit() {
    if (aspectRatio == null || !videoW || !videoH) return;
    const videoAr = videoW / videoH;
    if (videoAr > aspectRatio) {
      const w = 1;
      const h = videoW / (videoH * aspectRatio);
      setEffectiveCrop({ x: 0, y: (1 - h) / 2, width: w, height: h });
    } else {
      const h = 1;
      const w = (videoH * aspectRatio) / videoW;
      setEffectiveCrop({ x: (1 - w) / 2, y: 0, width: w, height: h });
    }
  }

  function applyCropAlign(side: 'left' | 'right' | 'top' | 'bottom') {
    setEffectiveCrop(prev => {
      const w = prev.width;
      const h = prev.height;
      switch (side) {
        case 'left':   return { ...prev, x: 0 };
        case 'right':  return { ...prev, x: Math.max(0, 1 - w) };
        case 'top':    return { ...prev, y: 0 };
        case 'bottom': return { ...prev, y: Math.max(0, 1 - h) };
      }
    });
  }

  function applyCropFill() {
    if (aspectRatio == null || !videoW || !videoH) return;
    const videoAr = videoW / videoH;
    if (videoAr > aspectRatio) {
      const h = 1;
      const w = (videoH * aspectRatio) / videoW;
      setEffectiveCrop({ x: (1 - w) / 2, y: 0, width: w, height: h });
    } else {
      const w = 1;
      const h = videoW / (videoH * aspectRatio);
      setEffectiveCrop({ x: 0, y: (1 - h) / 2, width: w, height: h });
    }
  }

  const rulerTicks = useMemo(() => {
    if (!videoDuration || videoDuration <= 0) {
      return { major: [] as number[], minor: [] as number[], interval: 1 };
    }
    const innerWidth = Math.max(1, scrollViewportW * timelineZoom);
    const pxPerSec = innerWidth / videoDuration;
    const targetSec = 90 / pxPerSec;
    const interval = pickRulerInterval(targetSec);
    const major: number[] = [];
    const minor: number[] = [];
    for (let t = 0; t <= videoDuration + 1e-3; t += interval) {
      major.push(Math.min(t, videoDuration));
    }
    const minorStep = interval / 5;
    if (minorStep > 0 && pxPerSec * minorStep > 6) {
      for (let t = minorStep; t < videoDuration - 1e-3; t += minorStep) {
        if (Math.abs(t / interval - Math.round(t / interval)) > 1e-6) {
          minor.push(t);
        }
      }
    }
    return { major, minor, interval };
  }, [videoDuration, timelineZoom, scrollViewportW]);

  function handleTimelineHover(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * videoDuration;
    setHoverPreview({ time, clientX: e.clientX, topY: rect.top });
  }

  function clearTimelineHover() {
    setHoverPreview(null);
  }

  function handleClearOtherProjects() {
    if (storageStats.othersCount === 0) return;
    const msg = (TRANSLATIONS[uiLang]['confirmClearOthers'] ?? TRANSLATIONS.en['confirmClearOthers'])
      .replace('{count}', String(storageStats.othersCount))
      .replace('{size}', formatBytes(storageStats.others));
    if (!window.confirm(msg)) return;
    clearOtherProjects(videoPath);
    setStorageStats(autosaveStats(videoPath));
  }

  return (
    <div className="app">
      <div className={'app-titlebar drag-region' + (IS_MAC ? ' is-mac' : '')}>
        <span className="app-titlebar-brand">SUBBI</span>
        <span className="app-titlebar-sep">—</span>
        <span className="app-titlebar-doc">
          {videoPath ? videoPath.split(/[\\/]/).pop() : t('untitledProject')}
        </span>
        {videoPath && (
          <span className={'app-titlebar-save' + (autosaveTick === 'saved' ? ' is-pulse' : '')}>
            {autosaveTick === 'saved' ? '● Saved' : '○ Auto'}
          </span>
        )}
        <span
          className="app-titlebar-storage"
          title={
            t('storageTooltip')
              .replace('{total}', formatBytes(storageStats.total))
              .replace('{count}', String(storageStats.count))
              .replace('{others}', formatBytes(storageStats.others))
              .replace('{othersCount}', String(storageStats.othersCount))
          }
        >
          {t('storageLabel').replace('{size}', formatBytes(storageStats.total))}
        </span>
        <button
          type="button"
          className="app-titlebar-open no-drag"
          onClick={pickFile}
          disabled={isBusy}
          title={t('openVideo')}
        >
          {t('openVideo')}
        </button>
        <button
          type="button"
          className="app-titlebar-clear no-drag"
          onClick={handleClearOtherProjects}
          disabled={storageStats.othersCount === 0}
          title={
            storageStats.othersCount === 0
              ? t('clearOthersNone')
              : t('clearOthersTitle')
                  .replace('{count}', String(storageStats.othersCount))
                  .replace('{size}', formatBytes(storageStats.others))
          }
        >
          {t('clearOthers')}
          {storageStats.othersCount > 0 && (
            <span className="app-titlebar-clear-badge">
              {formatBytes(storageStats.others)}
            </span>
          )}
        </button>
        <button
          type="button"
          className="app-titlebar-theme no-drag"
          onClick={cycleTheme}
          title={
            themePref === 'system' ? t('themeSystem')
              : themePref === 'light' ? t('themeLight')
              : t('themeDark')
          }
          aria-label={
            themePref === 'system' ? t('themeSystem')
              : themePref === 'light' ? t('themeLight')
              : t('themeDark')
          }
        >
          {themePref === 'system' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="13" rx="1" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          ) : themePref === 'light' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="app-titlebar-lang no-drag">
          <Select
            size="sm"
            value={uiLang}
            onChange={v => onUiLangChange(v as UiLang)}
            options={[{ value: 'en', label: 'EN' }, { value: 'es', label: 'ES' }]}
          />
        </div>
      </div>
      <div className="app-body">
      <div className={'preview' + (!videoUrl ? ' drag-region' : '')}
           onDragOver={(e) => { e.preventDefault(); setOver(true); }}
           onDragLeave={() => setOver(false)}
           onDrop={onDrop}>
        {!videoUrl && (
          <label className={'dropzone' + (over ? ' over' : '')} onClick={pickFile}>
            <div style={{ fontSize: 42, marginBottom: 12, lineHeight: 1 }}>{over ? '⬇' : '🎬'}</div>
            <div style={{ fontSize: 18, marginBottom: 12 }}>{over ? t('dropNow') : t('dropHere')}</div>
            <span className="dropzone-cta">{t('openVideo')}</span>
          </label>
        )}
        {videoUrl && (
          <div className="preview-toolbar">
            <button className="vc-btn" onClick={zoomOut} title="Zoom out (Ctrl −)" disabled={previewZoom <= ZOOM_MIN}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2"/></svg>
            </button>
            <button className="vc-zoom-label" onClick={zoomFit} title="Fit (Ctrl 0)">
              {previewZoom === 1
                ? 'Fit'
                : (() => {
                    const vw = videoRef.current?.videoWidth || 0;
                    const vh = videoRef.current?.videoHeight || 0;
                    if (!vw || !vh || !stageSize.w || !stageSize.h) return `${Math.round(previewZoom * 100)}%`;
                    const fit = Math.min(stageSize.w / vw, stageSize.h / vh);
                    return `${Math.round(fit * previewZoom * 100)}%`;
                  })()}
            </button>
            <button className="vc-btn" onClick={zoomIn} title="Zoom in (Ctrl +)" disabled={previewZoom >= ZOOM_MAX}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2"/><rect x="11" y="5" width="2" height="14"/></svg>
            </button>
            <button className="pr-btn pr-btn-ghost vc-fit-btn" onClick={zoomFit} title="Fit (Ctrl 0)">Fit</button>
            <button className="pr-btn pr-btn-ghost vc-fit-btn" onClick={zoomActual} title="Actual pixels (100%)">1:1</button>
            <span className="vc-spacer" />
            <span className="pr-label" title={t('previewSpeedTitle')} style={{ marginRight: 6 }}>{t('previewSpeed')}</span>
            <Select
              size="sm"
              value={String(previewSpeed)}
              onChange={v => setPreviewSpeed(+v)}
              options={[
                { value: '0.25', label: '0.25×' },
                { value: '0.5', label: '0.5×' },
                { value: '0.75', label: '0.75×' },
                { value: '1', label: '1×' },
                { value: '1.25', label: '1.25×' },
                { value: '1.5', label: '1.5×' },
                { value: '2', label: '2×' },
                { value: '3', label: '3×' },
                { value: '4', label: '4×' },
              ]}
            />
            <span className="vc-spacer" />
            <button
              data-reset-key="all"
              className={'pr-btn pr-btn-ghost vc-reset-btn' + (confirmReset === 'all' ? ' is-confirming' : '')}
              onClick={() => {
                if (confirmReset === 'all') { resetAllEdits(); clearArmedReset(); }
                else armReset('all');
              }}
              disabled={isEditBusy}
              title={t('resetEditsTitle')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <polyline points="3 4 3 9 8 9" />
              </svg>
              <span>{confirmReset === 'all' ? t('resetConfirm') : t('resetEdits')}</span>
            </button>
          </div>
        )}
        {videoUrl && (() => {
          const cropApplied = !bsPreset && cropEnabled && !cropEditing && videoW > 0 && videoH > 0;
          let croppedWrapW = 0, croppedWrapH = 0;
          if (cropApplied && stageSize.w > 0 && stageSize.h > 0) {
            const sliceAspect = (effectiveCrop.width * videoW) / (effectiveCrop.height * videoH);
            const stageAspect = stageSize.w / stageSize.h;
            if (sliceAspect > stageAspect) {
              croppedWrapW = stageSize.w;
              croppedWrapH = stageSize.w / sliceAspect;
            } else {
              croppedWrapH = stageSize.h;
              croppedWrapW = stageSize.h * sliceAspect;
            }
          }
          const baseW = videoRef.current?.videoWidth || 1280;
          const baseH = videoRef.current?.videoHeight || 720;
          const cropBg = cropBgColor === 'white' ? '#ffffff' : '#000000';
          const opacityActive = opacity < 100;
          const opacityBg = opacityBgColor === 'white' ? '#ffffff' : '#000000';
          const wrapBg = opacityActive ? opacityBg : cropBg;
          const bsBg = blackScreenBgColor === 'white' ? '#ffffff' : '#000000';
          const wrapStyle: React.CSSProperties | undefined = bsPreset
            ? (bsFit
                ? { width: `${bsFit.w}px`, height: `${bsFit.h}px`, overflow: 'hidden', backgroundColor: bsBg }
                : { backgroundColor: bsBg })
            : previewZoom !== 1
            ? (cropApplied
                ? {
                    width: `${baseW * effectiveCrop.width * previewZoom}px`,
                    height: `${baseH * effectiveCrop.height * previewZoom}px`,
                    overflow: 'hidden',
                    backgroundColor: wrapBg,
                  }
                : {
                    width: `${baseW * previewZoom}px`,
                    height: `${baseH * previewZoom}px`,
                    backgroundColor: opacityActive ? opacityBg : undefined,
                  })
            : (cropApplied && croppedWrapW > 0
                ? { width: `${croppedWrapW}px`, height: `${croppedWrapH}px`, overflow: 'hidden', backgroundColor: wrapBg }
                : (opacityActive ? { backgroundColor: opacityBg } : undefined));
          const filterCss = saturation !== 100 ? `saturate(${(saturation / 100).toFixed(3)})` : undefined;
          const opacityCss = opacityActive ? opacity / 100 : undefined;
          const videoStyle: React.CSSProperties | undefined = bsPreset ? {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            maxHeight: 'none',
            opacity: 0,
          } : cropApplied ? {
            position: 'absolute',
            top: `${-effectiveCrop.y * 100 / effectiveCrop.height}%`,
            left: `${-effectiveCrop.x * 100 / effectiveCrop.width}%`,
            width: `${100 / effectiveCrop.width}%`,
            height: `${100 / effectiveCrop.height}%`,
            maxWidth: 'none',
            maxHeight: 'none',
            filter: filterCss,
            opacity: opacityCss,
          } : (filterCss || opacityCss != null ? { filter: filterCss, opacity: opacityCss } : undefined);
          return (
          <div className="video-stage" ref={setStageRef}>
            <div
              className={'video-wrap' + (previewZoom !== 1 ? ' is-zoomed' : '') + (cropApplied ? ' is-cropped' : '')}
              style={wrapStyle}
            >
              <video
                key={videoUrl ?? ''}
                ref={videoRef}
                src={videoUrl}
                onClick={togglePlay}
                onLoadedMetadata={() => bumpVideoEl(n => n + 1)}
                style={videoStyle}
              />
              {bgAudio && (
                <audio
                  ref={bgAudioRef}
                  src={bgAudio.url}
                  preload="auto"
                  style={{ display: 'none' }}
                />
              )}
              {subtitlesEnabled && (
              <div
                className={
                  'subtitle-overlay'
                  + (activeCue ? '' : ' sample')
                  + (activeCue && !editingCue ? ' is-editable' : '')
                  + (editingCue ? ' is-editing' : '')
                }
                style={overlayStyle}
                onClick={(e) => {
                  if (!activeCue || editingCue) return;
                  e.stopPropagation();
                  beginEditCue();
                }}
                title={activeCue && !editingCue ? t('clickToEditCue') : undefined}
              >
                {editingCue ? (
                  <textarea
                    className="subtitle-edit"
                    value={editingText}
                    autoFocus
                    rows={Math.max(1, editingText.split('\n').length)}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitEditCue();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEditCue();
                      }
                      e.stopPropagation();
                    }}
                    onBlur={commitEditCue}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontFamily: effectiveStyle.fontName,
                      fontSize: `${effectiveStyle.fontSize * previewDisplayScale}px`,
                      color: effectiveStyle.color,
                      fontWeight: effectiveStyle.fontWeight === 'bold' ? 700 : effectiveStyle.fontWeight === 'semibold' ? 600 : 400,
                      textAlign: 'center',
                    }}
                  />
                ) : (
                  previewText
                )}
              </div>
              )}
              {!bsPreset && cropEnabled && cropEditing && (
                <CropOverlay
                  videoEl={videoRef.current}
                  crop={effectiveCrop}
                  aspectRatio={aspectRatio}
                  onChange={setEffectiveCrop}
                  onApply={() => setCropEditing(false)}
                  onUserResize={() => setAspectId('free')}
                  applyLabel={t('cropApply')}
                  fitLabel={t('cropFit')}
                  fillLabel={t('cropFill')}
                  onFit={aspectRatio != null ? applyCropFit : undefined}
                  onFill={aspectRatio != null ? applyCropFill : undefined}
                  onAlign={applyCropAlign}
                  alignLeftLabel={t('cropAlignLeft')}
                  alignRightLabel={t('cropAlignRight')}
                  alignTopLabel={t('cropAlignTop')}
                  alignBottomLabel={t('cropAlignBottom')}
                  bgColor={cropBgColor}
                />
              )}
            </div>
          </div>
          );
        })()}
        {videoUrl && (
          <div className="video-controls">
            <button
              className="vc-btn"
              onClick={togglePlay}
              title={isPlaying ? `${t('pause')} (Space)` : `${t('play')} (Space)`}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a.5.5 0 0 0 .76.43l13-7.5a.5.5 0 0 0 0-.86l-13-7.5A.5.5 0 0 0 7 4.5z"/></svg>
              )}
            </button>
            <button className="vc-btn" onClick={() => seekTo(currentTime - 5)} title={t('back5s')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5v3l-4-4 4-4v3a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6z"/></svg>
            </button>
            <button className="vc-btn" onClick={() => seekTo(currentTime + 5)} title={t('fwd5s')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M11 5v3l-4-4 4-4v3a8 8 0 1 1-8 8h2a6 6 0 1 0 6-6z"/></svg>
            </button>
            <div className="vc-time">
              <span className="vc-time-cur">{fmtTime(currentTime)}</span>
              <span className="vc-time-sep"> / </span>
              <span className="vc-time-tot">{fmtTime(videoDuration)}</span>
            </div>
            {nearbyMarker != null ? (
              <button
                className="vc-btn vc-split-btn vc-split-cancel"
                onClick={removeSplitAtCurrent}
                disabled={!videoDuration || isEditBusy}
                title={t('cancelSplitHere')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                  <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                  <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                </svg>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{marginLeft: 2}}>
                  <path d="M18.3 5.71L12 12.01l-6.3-6.3-1.4 1.4 6.29 6.3-6.29 6.29 1.4 1.42 6.3-6.3 6.3 6.3 1.4-1.42-6.29-6.29 6.29-6.3z"/>
                </svg>
              </button>
            ) : (
              <button
                className="vc-btn vc-split-btn"
                onClick={addSplitAtCurrent}
                disabled={!videoDuration || isEditBusy}
                title={t('splitHere')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                  <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                  <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                </svg>
              </button>
            )}
            {selectedMarker != null && (
              <button
                className="vc-btn vc-split-remove"
                onClick={removeSelectedMarker}
                disabled={isEditBusy}
                title={t('removeSplit')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.3 5.71L12 12.01l-6.3-6.3-1.4 1.4 6.29 6.3-6.29 6.29 1.4 1.42 6.3-6.3 6.3 6.3 1.4-1.42-6.29-6.29 6.29-6.3z"/>
                </svg>
              </button>
            )}
            {splitMarkers.length > 0 && (
              <span className="vc-split-count" title={t('exportPartsHint')}>
                {splitMarkers.length} {t('splitsBadge')}
              </span>
            )}
            {splitSegments.length > 1 && (() => {
              const excludedCount = splitSegments.filter(s => excludedSegments[s.key]).length;
              const includedCount = splitSegments.length - excludedCount;
              return (
                <span
                  className="vc-split-count"
                  title={t('segmentsCountTip').replace('{in}', String(includedCount)).replace('{out}', String(excludedCount))}
                >
                  {includedCount}/{splitSegments.length} {t('segmentsIncluded')}
                </span>
              );
            })()}
            <span className="vc-spacer" />
            <span className="vc-zoom-icon" title={`${t('zoomTimeline')}: ${timelineZoom.toFixed(1)}x`}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16" y2="16" />
              </svg>
            </span>
            {(() => {
              const timelineZoomMax = Math.max(10, Math.ceil((videoDuration || 0) / 10));
              return (
                <input
                  type="range"
                  className="pr-range vc-zoom"
                  min={1}
                  max={timelineZoomMax}
                  step={0.1}
                  value={Math.min(timelineZoom, timelineZoomMax)}
                  disabled={!videoDuration}
                  style={rangePct(Math.min(timelineZoom, timelineZoomMax), 1, timelineZoomMax)}
                  onChange={(e) => setTimelineZoom(+e.target.value)}
                  title={`${t('zoomTimeline')}: ${timelineZoom.toFixed(1)}x`}
                />
              );
            })()}
            {timelineZoom !== 1 && (
              <button
                type="button"
                className="vc-zoom-reset"
                onClick={() => setTimelineZoom(1)}
                title={t('zoomReset')}
              >×</button>
            )}
            <button
              className="vc-btn"
              onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted; }}
              title={muted || volume === 0 ? `${t('unmute')} (M)` : `${t('mute')} (M)`}
            >
              {muted || volume === 0 ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.59 3L19 9.41 17.59 8 15 10.59 12.41 8 11 9.41 13.59 12 11 14.59 12.41 16 15 13.41 17.59 16 19 14.59 16.59 12z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06A6.99 6.99 0 0 1 19 12a6.99 6.99 0 0 1-5 6.71v2.06A8.99 8.99 0 0 0 21 12 8.99 8.99 0 0 0 14 3.23z"/></svg>
              )}
            </button>
            <input
              type="range"
              className="pr-range vc-volume"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              style={rangePct(muted ? 0 : volume, 0, 1)}
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = +e.target.value;
                if (+e.target.value > 0 && v.muted) v.muted = false;
              }}
            />
          </div>
        )}
        {videoUrl && (
          <div className="audio-strip">
            <div className="audio-strip-main">
              <div
                ref={timelineScrollRef}
                className="audio-strip-scroll"
                onMouseLeave={clearTimelineHover}
              >
                <div
                  className="audio-strip-zoomable"
                  style={{ width: `${timelineZoom * 100}%` }}
                  onMouseMove={handleTimelineHover}
                  onMouseEnter={handleTimelineHover}
                >
                  {hoverPreview && videoDuration > 0 && (
                    <div
                      className="audio-strip-hoverline"
                      style={{ left: `${(hoverPreview.time / videoDuration) * 100}%` }}
                    />
                  )}
                  {videoDuration > 0 && (
                    <div className="audio-strip-exportbar">
                      {splitSegments.map((seg, i) => {
                        const widthPct = ((seg.end - seg.start) / videoDuration) * 100;
                        const excluded = !!excludedSegments[seg.key];
                        return (
                          <button
                            key={seg.key}
                            type="button"
                            className={'audio-strip-exportseg' + (excluded ? ' is-excluded' : '')}
                            style={{ width: `${widthPct}%` }}
                            onClick={() => toggleSegmentExcluded(seg.key)}
                            title={excluded ? t('includeSegment') : t('excludeSegment')}
                          >
                            <span className="audio-strip-exportseg-label">
                              {t('segmentLabel').replace('{n}', String(i + 1))}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {videoDuration > 0 && (
                    <div className="audio-strip-ruler">
                      {rulerTicks.minor.map((t, i) => (
                        <div
                          key={`mn-${i}`}
                          className="audio-strip-ruler-tick is-minor"
                          style={{ left: `${(t / videoDuration) * 100}%` }}
                        />
                      ))}
                      {rulerTicks.major.map((t, i) => {
                        const left = (t / videoDuration) * 100;
                        const isLast = i === rulerTicks.major.length - 1;
                        return (
                          <div
                            key={`mj-${i}`}
                            className="audio-strip-ruler-tick is-major"
                            style={{ left: `${left}%` }}
                          >
                            <span
                              className={'audio-strip-ruler-label' + (isLast ? ' is-end' : '')}
                            >
                              {fmtRulerTime(t, rulerTicks.interval)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="audio-strip-seek">
                    <input
                      type="range"
                      className="pr-range vc-seek"
                      min={0}
                      max={Math.max(0.01, videoDuration)}
                      step={0.01}
                      value={Math.min(currentTime, videoDuration || 0)}
                      style={rangePct(Math.min(currentTime, videoDuration || 0), 0, Math.max(0.01, videoDuration))}
                      onChange={(e) => seekTo(+e.target.value)}
                    />
                  </div>
                  <div className="audio-strip-timeline">
                    <SilenceTimeline
                      key={videoUrl}
                      ref={timelineRef}
                      videoEl={videoRef.current}
                      peaks={peaks}
                      duration={videoDuration}
                      regions={silenceRegions}
                      currentTime={currentTime}
                      onToggleRegion={toggleSilence}
                      onUpdateRegion={updateSilence}
                      onRemoveRegion={removeSilence}
                      splitMarkers={splitMarkers}
                      selectedMarker={selectedMarker}
                      onSelectMarker={setSelectedMarker}
                      theme={resolvedTheme}
                    />
                  </div>
                  {videoDuration > 0 && (
                    <BgAudioTrack
                      bgAudio={bgAudio}
                      videoDuration={videoDuration}
                      loading={bgAudioLoading}
                      onAdd={importBgAudio}
                      onRemove={removeBgAudio}
                      onChange={updateBgAudio}
                      onDropFile={handleBgAudioDrop}
                      labels={{
                        add: t('bgAudioAdd'),
                        remove: t('bgAudioRemove'),
                        loading: t('bgAudioLoading'),
                        dragHint: t('bgAudioDragHint'),
                      }}
                    />
                  )}
                </div>
              </div>
              {peaks === null && (
                <div className="audio-strip-hint">{t('generatingWaveform')}</div>
              )}
              {silenceRegions.length > 0 && (
                <div className="audio-strip-hint">{t('clickRegionToToggle')}</div>
              )}
            </div>
            <div className="audio-strip-faders">
              <div className="audio-fader">
                <span
                  className="audio-fader-key has-tip"
                  data-tip={`${t('audioGain')}: ${volumeDb > 0 ? '+' : ''}${volumeDb} dB`}
                >G</span>
                <input
                  type="range"
                  min={-30} max={30} step={1}
                  value={volumeDb}
                  disabled={!videoPath || isEditBusy}
                  onChange={e => setVolumeDb(+e.target.value)}
                  className="pr-range pr-range-v"
                  style={rangePct(volumeDb, -30, 30)}
                />
                <span className="audio-fader-num">{volumeDb > 0 ? '+' : ''}{volumeDb}</span>
              </div>
              {bgAudio && (
                <div className={'audio-fader' + (bgAudio.muted ? ' is-off' : '')}>
                  <button
                    type="button"
                    className={'audio-fader-key audio-fader-key-btn has-tip' + (bgAudio.muted ? '' : ' is-on')}
                    onClick={() => updateBgAudio({ muted: !bgAudio.muted })}
                    disabled={!videoPath || isEditBusy}
                    data-tip={`${t('bgAudioVolume')}: ${bgAudio.muted ? t('audioGateOff') : `${bgAudio.volumeDb > 0 ? '+' : ''}${bgAudio.volumeDb} dB`}`}
                  >B</button>
                  <input
                    type="range"
                    min={-30} max={30} step={1}
                    value={bgAudio.volumeDb}
                    disabled={!videoPath || isEditBusy || bgAudio.muted}
                    onChange={e => updateBgAudio({ volumeDb: +e.target.value })}
                    className="pr-range pr-range-v"
                    style={rangePct(bgAudio.volumeDb, -30, 30)}
                  />
                  <span className="audio-fader-num">
                    {bgAudio.muted ? '–' : `${bgAudio.volumeDb > 0 ? '+' : ''}${bgAudio.volumeDb}`}
                  </span>
                </div>
              )}
              <div className={'audio-fader' + (noiseGateEnabled ? '' : ' is-off')}>
                <button
                  type="button"
                  className={'audio-fader-key audio-fader-key-btn has-tip' + (noiseGateEnabled ? ' is-on' : '')}
                  onClick={() => setNoiseGateEnabled(v => !v)}
                  disabled={!videoPath || isEditBusy}
                  data-tip={`${t('audioGate')}: ${noiseGateEnabled ? `${noiseGateDb} dB` : t('audioGateOff')}`}
                >N</button>
                <input
                  type="range"
                  min={-80} max={-20} step={1}
                  value={noiseGateDb}
                  disabled={!videoPath || isEditBusy || !noiseGateEnabled}
                  onChange={e => setNoiseGateDb(+e.target.value)}
                  className="pr-range pr-range-v"
                  style={rangePct(noiseGateDb, -80, -20)}
                />
                <span className="audio-fader-num">
                  {noiseGateEnabled ? noiseGateDb : '–'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="pr-sidebar">

        <div className={'pr-section' + (openSections.templates ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('templates')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionTemplates')}</span>
          </button>
          <div className="pr-section-body">
            {showSaveTemplate ? (
              <div className="pr-row pr-template-save-row">
                <input
                  type="text"
                  autoFocus
                  className="pr-input pr-input-flex"
                  placeholder={t('templateNamePlaceholder')}
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); saveCurrentAsTemplate(); }
                    else if (e.key === 'Escape') { e.preventDefault(); setShowSaveTemplate(false); setNewTemplateName(''); }
                  }}
                />
                <button type="button" className="pr-btn pr-btn-primary" onClick={saveCurrentAsTemplate}>
                  {t('templateSaveBtn')}
                </button>
                <button type="button" className="pr-btn" onClick={() => { setShowSaveTemplate(false); setNewTemplateName(''); }}>
                  {t('templateCancelBtn')}
                </button>
              </div>
            ) : (
              <div className="pr-row">
                <button
                  type="button"
                  className="pr-btn pr-template-save-btn"
                  onClick={() => { setShowSaveTemplate(true); setNewTemplateName(''); }}
                >
                  + {t('templateSaveCurrent')}
                </button>
              </div>
            )}
            {templates.length === 0 ? (
              <div className="pr-row pr-template-empty">{t('templateEmpty')}</div>
            ) : (
              <div className="pr-template-list">
                {templates.map(tpl => {
                  const armed = confirmDeleteTemplate === tpl.id;
                  return (
                    <div key={tpl.id} className="pr-template-item">
                      <span className="pr-template-name" title={tpl.name}>{tpl.name}</span>
                      <button
                        type="button"
                        className="pr-btn pr-btn-sm"
                        onClick={() => applyTemplate(tpl)}
                        disabled={!!pendingTemplateRun}
                      >
                        {t('templateApply')}
                      </button>
                      <button
                        type="button"
                        className={'pr-btn pr-btn-sm pr-btn-danger' + (armed ? ' is-confirming' : '')}
                        title={armed ? t('templateConfirmDelete') : t('templateDelete')}
                        onClick={() => {
                          if (armed) deleteTemplate(tpl.id);
                          else setConfirmDeleteTemplate(tpl.id);
                        }}
                        onBlur={() => setConfirmDeleteTemplate(null)}
                      >
                        {armed ? '?' : '×'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {templateToast && (
              <div className="pr-row pr-template-toast">{templateToast}</div>
            )}
          </div>
        </div>

        <div className={'pr-section' + (openSections.crop ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('crop')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionCrop')}</span>
            {cropEnabled && <span className="pr-badge">ON</span>}
            {splitMarkers.length > 0 && !cropApplyToAll && Object.keys(cropByZone).length > 0 && (
              <span className="pr-badge">{splitSegments.length} {t('cropZonesBadge')}</span>
            )}
            {renderSectionReset(
              'crop',
              resetCrop,
              cropEnabled || aspectId !== 'free' || Object.keys(cropByZone).length > 0 || crop.x !== DEFAULT_CROP.x || crop.y !== DEFAULT_CROP.y || crop.width !== DEFAULT_CROP.width || crop.height !== DEFAULT_CROP.height
            )}
          </button>
          <div className="pr-section-body">
            {splitMarkers.length > 0 && (
              <div className="pr-row">
                <label className="pr-check">
                  <input type="checkbox"
                         checked={cropApplyToAll}
                         onChange={e => setCropApplyToAll(e.target.checked)} />
                  <span>{t('cropApplyToAll')}</span>
                </label>
              </div>
            )}
            <div className="pr-row">
              <span className="pr-label">{t('aspectRatio')}</span>
              <div className="pr-aspect-row">
                {ASPECT_PRESETS.map(p => (
                  <button
                    key={p.id}
                    disabled={!videoPath || isEditBusy}
                    onClick={() => {
                      setAspectId(p.id);
                      setCropEnabled(true);
                      setCropEditing(true);
                    }}
                    className={'pr-chip' + (cropEnabled && aspectId === p.id ? ' pr-chip-on' : '')}
                  >{p.id === 'free' ? t('aspectFree') : p.label}</button>
                ))}
              </div>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('cropBg')}</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy}
                  onClick={() => setCropBgColor('black')}
                  className={'pr-chip' + (cropBgColor === 'black' ? ' pr-chip-on' : '')}
                >{t('cropBgBlack')}</button>
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy}
                  onClick={() => setCropBgColor('white')}
                  className={'pr-chip' + (cropBgColor === 'white' ? ' pr-chip-on' : '')}
                >{t('cropBgWhite')}</button>
              </div>
            </div>
            {aspectRatio != null && (
              <div className="pr-row">
                <span className="pr-label">&nbsp;</span>
                <div className="pr-aspect-row">
                  <button
                    type="button"
                    disabled={!videoPath || !videoW || isEditBusy}
                    onClick={() => { setCropEnabled(true); setCropEditing(true); applyCropFit(); }}
                    className="pr-chip"
                  >{t('cropFit')}</button>
                  <button
                    type="button"
                    disabled={!videoPath || !videoW || isEditBusy}
                    onClick={() => { setCropEnabled(true); setCropEditing(true); applyCropFill(); }}
                    className="pr-chip"
                  >{t('cropFill')}</button>
                </div>
              </div>
            )}
            <div className="pr-row">
              <span className="pr-label">{t('cropAlign')}</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  disabled={!videoPath || !videoW || isEditBusy}
                  onClick={() => { setCropEnabled(true); applyCropAlign('left'); }}
                  className="pr-chip"
                  title={t('cropAlignLeft')}
                  aria-label={t('cropAlignLeft')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="3" x2="4" y2="21"/><rect x="7" y="7" width="11" height="10"/></svg>
                </button>
                <button
                  type="button"
                  disabled={!videoPath || !videoW || isEditBusy}
                  onClick={() => { setCropEnabled(true); applyCropAlign('right'); }}
                  className="pr-chip"
                  title={t('cropAlignRight')}
                  aria-label={t('cropAlignRight')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="20" y1="3" x2="20" y2="21"/><rect x="6" y="7" width="11" height="10"/></svg>
                </button>
                <button
                  type="button"
                  disabled={!videoPath || !videoH || isEditBusy}
                  onClick={() => { setCropEnabled(true); applyCropAlign('top'); }}
                  className="pr-chip"
                  title={t('cropAlignTop')}
                  aria-label={t('cropAlignTop')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4" x2="21" y2="4"/><rect x="7" y="7" width="10" height="11"/></svg>
                </button>
                <button
                  type="button"
                  disabled={!videoPath || !videoH || isEditBusy}
                  onClick={() => { setCropEnabled(true); applyCropAlign('bottom'); }}
                  className="pr-chip"
                  title={t('cropAlignBottom')}
                  aria-label={t('cropAlignBottom')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="20" x2="21" y2="20"/><rect x="7" y="6" width="10" height="11"/></svg>
                </button>
              </div>
            </div>
            <div className="pr-row pr-crop-px-row">
              <span className="pr-label">{t('cropPixels')}</span>
              <div className="pr-crop-px-grid">
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropX')}</span>
                  <input
                    type="number" min={0} step={1}
                    value={cropPxX}
                    disabled={!videoPath || !videoW || isEditBusy}
                    onChange={(e) => updateCropFromPixels({ x: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropY')}</span>
                  <input
                    type="number" min={0} step={1}
                    value={cropPxY}
                    disabled={!videoPath || !videoH || isEditBusy}
                    onChange={(e) => updateCropFromPixels({ y: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropW')}</span>
                  <input
                    type="number" min={1} step={1}
                    value={cropPxW}
                    disabled={!videoPath || !videoW || isEditBusy}
                    onChange={(e) => updateCropFromPixels({ w: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropH')}</span>
                  <input
                    type="number" min={1} step={1}
                    value={cropPxH}
                    disabled={!videoPath || !videoH || isEditBusy}
                    onChange={(e) => updateCropFromPixels({ h: +e.target.value })}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
              </div>
            </div>
            <div className="pr-row">
              <span className="pr-label">Center</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  className="pr-chip"
                  disabled={!videoPath || isEditBusy}
                  title="Center horizontally"
                  onClick={() => setEffectiveCrop(c => ({ ...c, x: (1 - c.width) / 2 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="6 9 3 12 6 15"/><polyline points="18 9 21 12 18 15"/></svg>
                </button>
                <button
                  type="button"
                  className="pr-chip"
                  disabled={!videoPath || isEditBusy}
                  title="Center vertically"
                  onClick={() => setEffectiveCrop(c => ({ ...c, y: (1 - c.height) / 2 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9 6 12 3 15 6"/><polyline points="9 18 12 21 15 18"/></svg>
                </button>
                <button
                  type="button"
                  className="pr-chip"
                  disabled={!videoPath || isEditBusy}
                  title="Center both"
                  onClick={() => setEffectiveCrop(c => ({ ...c, x: (1 - c.width) / 2, y: (1 - c.height) / 2 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>
                </button>
              </div>
            </div>
            {splitMarkers.length > 0 && (
              <div className="pr-row">
                <span className="pr-label">{t('cropZonesBadge')}</span>
                <span className="pr-value">
                  {t('cropActiveZone').replace('{n}', String(activeSegmentIdx + 1)).replace('{total}', String(splitSegments.length))}
                </span>
              </div>
            )}
            <div className="pr-row pr-row-end">
              <button
                onClick={() => {
                  setAspectId('free');
                  setCropEditing(false);
                  if (splitMarkers.length === 0) {
                    setCrop(DEFAULT_CROP);
                    setCropEnabled(false);
                  } else {
                    setCropByZone(prev => ({ ...prev, [activeSegmentKey]: { x: 0, y: 0, width: 1, height: 1 } }));
                  }
                }}
                disabled={!videoPath || isEditBusy}
                className="pr-btn pr-btn-ghost">
                {t('resetCrop')}
              </button>
              <button
                onClick={() => setCropEditing(v => !v)}
                disabled={!cropEnabled || isEditBusy}
                className="pr-btn pr-btn-ghost">
                {cropEditing ? t('cropApply') : t('cropEdit')}
              </button>
              <button
                onClick={() => { setCropEnabled(false); setCropEditing(false); }}
                disabled={!cropEnabled || isEditBusy}
                className="pr-btn pr-btn-ghost">
                {t('disableCrop')}
              </button>
            </div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.silence ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('silence')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionSilence')}</span>
            {silenceRegions.length > 0 && (
              <span className="pr-badge">{enabledCount}/{silenceRegions.length} · −{totalCutSec.toFixed(1)}s</span>
            )}
            {renderSectionReset(
              'silence',
              resetSilence,
              silenceRegions.length > 0 || thresholdDb !== -30 || !autoThreshold || Math.abs(minSilenceDur - 0.5) > 1e-6
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('threshold')}</span>
              <input type="range" min={-60} max={-10} step={1} value={thresholdDb}
                     disabled={isSilenceBusy || autoThreshold}
                     onChange={e => setThresholdDb(+e.target.value)}
                     style={rangePct(thresholdDb, -60, -10)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{thresholdDb} dB</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('minDuration')}</span>
              <input type="range" min={0.1} max={2} step={0.05} value={minSilenceDur}
                     disabled={isSilenceBusy}
                     onChange={e => setMinSilenceDur(+e.target.value)}
                     style={rangePct(minSilenceDur, 0.1, 2)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{minSilenceDur.toFixed(2)}s</span>
            </div>
            <div className="pr-row">
              <label className="pr-check">
                <input type="checkbox" checked={autoThreshold} disabled={isSilenceBusy}
                       onChange={e => setAutoThreshold(e.target.checked)} />
                <span>{t('autoMean')}{meanVolumeDb != null ? ` · ${meanVolumeDb.toFixed(1)} dB` : ''}</span>
              </label>
            </div>
            <div className="pr-row pr-row-end">
              <button onClick={addManualExclusion} disabled={!videoPath || isSilenceBusy || !videoDuration} className="pr-btn pr-btn-ghost">
                {t('addManualExclusion')}
              </button>
              <button onClick={detectSilencesNow} disabled={!videoPath || isSilenceBusy} className="pr-btn">
                {proc.phase === 'detecting' ? `${t('detecting')}…` : t('detectSilences')}
              </button>
            </div>
            {silenceRegions.length === 0 && proc.phase !== 'detecting' && meanVolumeDb != null && (
              <div className="pr-hint">{t('noSilences')}</div>
            )}
          </div>
        </div>

        <div className={'pr-section' + (openSections.audio ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('audio')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('audioSection')}</span>
            {Math.abs(volumeDb) > 0.01 && (
              <span className="pr-badge">{volumeDb > 0 ? '+' : ''}{volumeDb} dB</span>
            )}
            {renderSectionReset(
              'audio',
              resetAudio,
              Math.abs(volumeDb) > 0.01 || noiseGateEnabled || noiseGateDb !== -40 || voiceCleanupEnabled
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('audioGain')}</span>
              <input type="range" min={-30} max={30} step={1} value={volumeDb}
                     disabled={!videoPath || isEditBusy}
                     onChange={e => setVolumeDb(+e.target.value)}
                     style={rangePct(volumeDb, -30, 30)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{volumeDb > 0 ? '+' : ''}{volumeDb} dB</span>
            </div>
            <div className="pr-row pr-row-end">
              <button
                onClick={() => setVolumeDb(0)}
                disabled={!videoPath || isEditBusy || volumeDb === 0}
                className="pr-btn pr-btn-ghost">
                {t('resetCrop')}
              </button>
            </div>
            <div className="pr-hint">{t('audioGainHint')}</div>

            <div className="pr-row" style={{ marginTop: 8 }}>
              <label className="pr-check">
                <input type="checkbox"
                       checked={noiseGateEnabled}
                       disabled={!videoPath || isEditBusy}
                       onChange={e => setNoiseGateEnabled(e.target.checked)} />
                <span>{t('audioGate')}</span>
              </label>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('threshold')}</span>
              <input type="range" min={-80} max={-20} step={1} value={noiseGateDb}
                     disabled={!videoPath || isEditBusy || !noiseGateEnabled}
                     onChange={e => setNoiseGateDb(+e.target.value)}
                     style={rangePct(noiseGateDb, -80, -20)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">
                {noiseGateEnabled ? `${noiseGateDb} dB` : t('audioGateOff')}
              </span>
            </div>
            <div className="pr-hint">{t('audioGateHint')}</div>

            <div className="pr-row" style={{ marginTop: 8 }}>
              <label className="pr-check">
                <input type="checkbox"
                       checked={voiceCleanupEnabled}
                       disabled={!videoPath || isEditBusy}
                       onChange={e => setVoiceCleanupEnabled(e.target.checked)} />
                <span>{t('voiceCleanup')}</span>
              </label>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('voiceCleanupIntensity')}</span>
              <Select
                className="pr-input-flex"
                value={voiceCleanupIntensity}
                onChange={v => setVoiceCleanupIntensity(v as 'light' | 'medium' | 'strong')}
                disabled={!videoPath || isEditBusy || !voiceCleanupEnabled}
                options={[
                  { value: 'light', label: t('voiceCleanupLight') },
                  { value: 'medium', label: t('voiceCleanupMedium') },
                  { value: 'strong', label: t('voiceCleanupStrong') },
                ]}
              />
            </div>
            <div className="pr-row pr-row-end">
              {!vcPreviewBusy && (
                <button
                  onClick={vcPreviewPath && vcPreviewIntensity === voiceCleanupIntensity ? revertVoiceCleanupPreview : applyVoiceCleanupPreview}
                  disabled={!videoPath || isEditBusy || !voiceCleanupEnabled}
                  className="pr-btn pr-btn-ghost">
                  {vcPreviewPath && vcPreviewIntensity === voiceCleanupIntensity
                    ? t('voiceCleanupPreviewOff')
                    : t('voiceCleanupPreviewOn')}
                </button>
              )}
              {vcPreviewBusy && (
                <button
                  onClick={cancelVoiceCleanupPreview}
                  className="pr-btn pr-btn-ghost">
                  {t('voiceCleanupPreviewCancel')} ({Math.round(vcPreviewPct)}%)
                </button>
              )}
            </div>
            <div className="pr-hint">{t('voiceCleanupHint')}</div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.filters ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('filters')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionFilters')}</span>
            {(saturation !== 100 || opacity !== 100 || playbackRate !== 1) && (
              <span className="pr-badge">ON</span>
            )}
            {renderSectionReset(
              'filters',
              resetFilters,
              saturation !== 100 || opacity !== 100 || opacityBgColor !== 'black' || playbackRate !== 1
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('filterSpeed')}</span>
              <Select
                className="pr-input-flex"
                value={timelapseEnabled ? '1' : String(playbackRate)}
                onChange={v => setPlaybackRate(+v)}
                disabled={!videoPath || isEditBusy || timelapseEnabled}
                options={[
                  { value: '0.25', label: '0.25×' },
                  { value: '0.5', label: '0.5×' },
                  { value: '0.75', label: '0.75×' },
                  { value: '1', label: '1×' },
                  { value: '1.25', label: '1.25×' },
                  { value: '1.5', label: '1.5×' },
                  { value: '2', label: '2×' },
                ]}
              />
              {timelapseEnabled && (
                <span className="pr-value" title={t('timelapseOverrideSpeed')}>{effectiveSpeed.toFixed(2)}×</span>
              )}
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('filterSaturation')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={saturation}
                disabled={!videoPath || isEditBusy}
                onChange={e => setSaturation(+e.target.value)}
                style={rangePct(saturation, 0, 100)}
                className="pr-range pr-range-flex"
              />
              <span className="pr-value">{saturation}</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('filterOpacity')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={opacity}
                disabled={!videoPath || isEditBusy}
                onChange={e => setOpacity(+e.target.value)}
                style={rangePct(opacity, 0, 100)}
                className="pr-range pr-range-flex"
              />
              <span className="pr-value">{opacity}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('filterOpacityBg')}</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy}
                  onClick={() => setOpacityBgColor('black')}
                  className={'pr-chip' + (opacityBgColor === 'black' ? ' pr-chip-on' : '')}
                >{t('cropBgBlack')}</button>
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy}
                  onClick={() => setOpacityBgColor('white')}
                  className={'pr-chip' + (opacityBgColor === 'white' ? ' pr-chip-on' : '')}
                >{t('cropBgWhite')}</button>
              </div>
            </div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.blackscreen ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('blackscreen')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('blackScreenSection')}</span>
            {blackScreenEnabled && (
              <span className="pr-badge">{blackScreenAspectId}</span>
            )}
            {renderSectionReset(
              'blackscreen',
              resetBlackScreen,
              blackScreenEnabled || blackScreenAspectId !== DEFAULT_BLACK_SCREEN_ASPECT || blackScreenBgColor !== 'black'
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <label className="pr-check">
                <input
                  type="checkbox"
                  checked={blackScreenEnabled}
                  disabled={!videoPath || isEditBusy}
                  onChange={e => setBlackScreenEnabled(e.target.checked)}
                />
                <span>{t('blackScreenEnable')}</span>
              </label>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('blackScreenFormat')}</span>
              <Select
                className="pr-input-flex"
                value={blackScreenAspectId}
                onChange={v => setBlackScreenAspectId(v)}
                disabled={!videoPath || isEditBusy || !blackScreenEnabled}
                options={BLACK_SCREEN_PRESETS.map(p => ({ value: p.id, label: p.label }))}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('blackScreenBg')}</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy || !blackScreenEnabled}
                  onClick={() => setBlackScreenBgColor('black')}
                  className={'pr-chip' + (blackScreenBgColor === 'black' ? ' pr-chip-on' : '')}
                >{t('cropBgBlack')}</button>
                <button
                  type="button"
                  disabled={!videoPath || isEditBusy || !blackScreenEnabled}
                  onClick={() => setBlackScreenBgColor('white')}
                  className={'pr-chip' + (blackScreenBgColor === 'white' ? ' pr-chip-on' : '')}
                >{t('cropBgWhite')}</button>
              </div>
            </div>
            <div className="pr-hint">{t('blackScreenHint')}</div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.timelapse ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('timelapse')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('timelapseSection')}</span>
            {timelapseEnabled && (
              <span className="pr-badge">{effectiveSpeed.toFixed(2)}×</span>
            )}
            {renderSectionReset(
              'timelapse',
              resetTimelapse,
              timelapseEnabled || timelapseTargetSec !== 60 || !timelapseMuteOriginal
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <label className="pr-check">
                <input
                  type="checkbox"
                  checked={timelapseEnabled}
                  disabled={!videoPath || isEditBusy}
                  onChange={e => setTimelapseEnabled(e.target.checked)}
                />
                <span>{t('timelapseEnable')}</span>
              </label>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('timelapseTarget')}</span>
              <input
                type="number"
                className="pr-input-flex"
                min={1}
                step={1}
                value={timelapseTargetSec}
                disabled={!videoPath || isEditBusy || !timelapseEnabled}
                onChange={e => {
                  const n = Math.max(0.1, +e.target.value || 0);
                  setTimelapseTargetSec(n);
                }}
              />
              <span className="pr-value">{t('timelapseSeconds')}</span>
            </div>
            <div className="pr-row">
              <label className="pr-check">
                <input
                  type="checkbox"
                  checked={timelapseMuteOriginal}
                  disabled={!videoPath || isEditBusy || !timelapseEnabled}
                  onChange={e => setTimelapseMuteOriginal(e.target.checked)}
                />
                <span>{t('timelapseMute')}</span>
              </label>
            </div>
            {timelapseEnabled && timelapseBaseDuration > 0 && (
              <div className="pr-hint">
                {t('timelapseComputed')
                  .replace('{x}', timelapseSpeed.toFixed(2))
                  .replace('{base}', timelapseBaseDuration.toFixed(2))
                  .replace('{target}', String(timelapseTargetSec))}
              </div>
            )}
            {timelapseEnabled && timelapseBaseDuration <= 0 && (
              <div className="pr-hint">{t('timelapseNoBase')}</div>
            )}
            {timelapseEnabled && timelapseSpeed > 100 && (
              <div className="pr-hint">{t('timelapseExtreme')}</div>
            )}
            <div className="pr-hint">{t('timelapseHint')}</div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.transcription ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('transcription')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionTranscription')}</span>
            {cues && <span className="pr-badge">{cues.length} {t('cues')}</span>}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <span className="pr-label">{t('model')}</span>
              <Select
                className="pr-input-flex"
                value={model}
                onChange={v => setModel(v as TranscribeModel)}
                disabled={isBusy}
                options={[
                  { value: 'fast', label: t('modelFast') },
                  { value: 'medium', label: t('modelMedium') },
                  { value: 'cloud', label: t('modelCloud') },
                ]}
              />
            </div>
            {model !== 'cloud' && (() => {
              const whisper = modelToBackend(model).whisper;
              const status = modelStatus[whisper];
              if (status.phase === 'present' || status.phase === 'idle') return null;
              const modelLabel = model === 'fast' ? t('modelFast') : t('modelMedium');
              const sizeLabel = model === 'fast' ? t('modelSizeFast') : t('modelSizeMedium');
              const pct = Math.max(0, Math.min(100, status.pct ?? 0));
              return (
                <div className="pr-model-dl">
                  {status.phase === 'checking' && (
                    <div className="pr-hint">{t('modelDownloadIntro').replace('{model}', `${modelLabel} (${sizeLabel})`)}</div>
                  )}
                  {status.phase === 'downloading' && (
                    <>
                      <div className="pr-hint">
                        {t('modelDownloading').replace('{model}', modelLabel).replace('{pct}', pct.toFixed(0))}
                      </div>
                      <div className="pr-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                        <div className="pr-progress-bar" style={{ width: `${pct}%` }} />
                      </div>
                    </>
                  )}
                  {status.phase === 'error' && (
                    <>
                      <div className="pr-hint pr-hint-error">{status.error || tEvt('evt:err.modelDownload')}</div>
                      <div className="pr-row pr-row-end">
                        <button
                          type="button"
                          className="pr-btn pr-btn-ghost"
                          onClick={() => setModelStatus(s => ({ ...s, [whisper]: { phase: 'idle' } }))}
                        >
                          {t('modelDownloadRetry')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {model === 'cloud' && (
              <>
                <div className="pr-row">
                  <span className="pr-label">{t('apiKey')}</span>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="pr-input pr-input-flex"
                    value={openaiApiKey}
                    onChange={e => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    disabled={isBusy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="pr-row pr-row-end">
                  <button
                    type="button"
                    className="pr-btn pr-btn-ghost"
                    onClick={() => setShowApiKey(s => !s)}
                    disabled={isBusy}
                  >
                    {showApiKey ? t('apiKeyHide') : t('apiKeyShow')}
                  </button>
                  <button
                    type="button"
                    className="pr-btn pr-btn-ghost"
                    onClick={() => setOpenaiApiKey('')}
                    disabled={isBusy || !openaiApiKey}
                  >
                    {t('apiKeyClear')}
                  </button>
                </div>
                <div className="pr-hint">{t('apiKeyHint')}</div>
              </>
            )}
            <div className="pr-row">
              <span className="pr-label">{t('language')}</span>
              <Select
                className="pr-input-flex"
                value={language}
                onChange={setLanguage}
                disabled={isBusy}
                options={[
                  { value: 'es', label: t('langSpanish') },
                  { value: 'en', label: t('langEnglish') },
                  { value: 'pt', label: t('langPortuguese') },
                  { value: 'auto', label: t('langAuto') },
                ]}
              />
            </div>
            <div className="pr-row pr-row-end">
              {rawCues && rawCues.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setRawCues(null); setSrtPath(null); setWordsTs(null); }}
                  disabled={isBusy}
                  className="pr-btn pr-btn-ghost"
                  title={t('removeTranscriptionsTitle')}
                >
                  {t('removeTranscriptions')}
                </button>
              )}
              <button
                onClick={transcribe}
                disabled={!videoPath || isBusy || (model === 'cloud' && !openaiApiKey.trim()) || (model !== 'cloud' && modelStatus[modelToBackend(model).whisper].phase !== 'present')}
                className="pr-btn"
              >
                {proc.phase === 'transcribing' ? `${t('transcribing')}… ${proc.pct.toFixed(0)}%` : t('transcribe')}
              </button>
            </div>
          </div>
        </div>

        <div className={'pr-section' + (openSections.style ? ' is-open' : ' is-closed')}>
          <button className="pr-section-head" onClick={() => toggleSection('style')} type="button">
            <span className="pr-section-chev" />
            <span className="pr-section-title">{t('sectionSubtitleStyle')}</span>
            {renderSectionReset(
              'style',
              resetStyle,
              (Object.keys(DEFAULT_STYLE) as (keyof SubtitleStyle)[]).some(k => (effectiveStyle as any)[k] !== (DEFAULT_STYLE as any)[k])
              || (splitMarkers.length > 0 && Object.keys(styleByZone).length > 0)
            )}
          </button>
          <div className="pr-section-body">
            <div className="pr-row">
              <label className="pr-check">
                <input type="checkbox"
                       checked={subtitlesEnabled}
                       onChange={e => setSubtitlesEnabled(e.target.checked)} />
                <span>{t('subtitlesEnabled')}</span>
              </label>
            </div>
            {splitMarkers.length > 0 && (
              <div className="pr-row">
                <label className="pr-check">
                  <input type="checkbox"
                         checked={styleApplyToAll}
                         onChange={e => setStyleApplyToAll(e.target.checked)} />
                  <span>{t('styleApplyToAll')}</span>
                </label>
              </div>
            )}
            <div className="pr-row">
              <span className="pr-label">{t('font')}</span>
              <Select
                className="pr-input-flex"
                value={effectiveStyle.fontName}
                onChange={v => setEffectiveStyle(s => ({ ...s, fontName: v }))}
                options={FONT_OPTIONS.map(f => ({ value: f, label: f }))}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('weight')}</span>
              <Select
                className="pr-input-flex"
                value={effectiveStyle.fontWeight}
                onChange={v => setEffectiveStyle(s => ({ ...s, fontWeight: v as SubtitleStyle['fontWeight'] }))}
                options={[
                  { value: 'normal', label: t('weightNormal') },
                  { value: 'semibold', label: t('weightSemibold') },
                  { value: 'bold', label: t('weightBold') },
                ]}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('size')}</span>
              <input type="range" min={12} max={80} value={effectiveStyle.fontSize}
                     onChange={e => setEffectiveStyle(s => ({ ...s, fontSize: +e.target.value }))}
                     style={rangePct(effectiveStyle.fontSize, 12, 80)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{effectiveStyle.fontSize}px</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('vertical')}</span>
              <input type="range" min={0} max={100} value={effectiveStyle.marginVPct}
                     onChange={e => setEffectiveStyle(s => ({ ...s, marginVPct: +e.target.value }))}
                     style={rangePct(effectiveStyle.marginVPct, 0, 100)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{effectiveStyle.marginVPct}%</span>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('horizontal')}</span>
              <input type="range" min={-50} max={50} value={effectiveStyle.marginHPct}
                     onChange={e => setEffectiveStyle(s => ({ ...s, marginHPct: +e.target.value }))}
                     style={rangePct(effectiveStyle.marginHPct, -50, 50)}
                     className="pr-range pr-range-flex" />
              <span className="pr-value">{effectiveStyle.marginHPct > 0 ? '+' : ''}{effectiveStyle.marginHPct}%</span>
            </div>
            <div className="pr-row pr-crop-px-row">
              <span className="pr-label">{t('cropPixels')}</span>
              <div className="pr-crop-px-grid">
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropX')}</span>
                  <input
                    type="number" step={1}
                    value={videoW ? Math.round(effectiveStyle.marginHPct / 100 * videoW) : 0}
                    disabled={!videoPath || !videoW || isEditBusy}
                    onChange={(e) => {
                      if (!videoW) return;
                      const px = Math.max(-videoW / 2, Math.min(videoW / 2, +e.target.value || 0));
                      setEffectiveStyle(s => ({ ...s, marginHPct: +(px / videoW * 100).toFixed(2) }));
                    }}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
                <label className="pr-crop-px-cell">
                  <span className="pr-crop-px-key">{t('cropY')}</span>
                  <input
                    type="number" min={0} step={1}
                    value={videoH ? Math.round(effectiveStyle.marginVPct / 100 * videoH) : 0}
                    disabled={!videoPath || !videoH || isEditBusy}
                    onChange={(e) => {
                      if (!videoH) return;
                      const px = Math.max(0, Math.min(videoH, +e.target.value || 0));
                      setEffectiveStyle(s => ({ ...s, marginVPct: +(px / videoH * 100).toFixed(2) }));
                    }}
                    className="pr-input pr-crop-px-input"
                  />
                </label>
              </div>
            </div>
            <div className="pr-row">
              <span className="pr-label">Center</span>
              <div className="pr-aspect-row">
                <button
                  type="button"
                  className="pr-chip"
                  title="Center horizontally"
                  onClick={() => setEffectiveStyle(s => ({ ...s, marginHPct: 0 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="6 9 3 12 6 15"/><polyline points="18 9 21 12 18 15"/></svg>
                </button>
                <button
                  type="button"
                  className="pr-chip"
                  title="Center vertically"
                  onClick={() => setEffectiveStyle(s => ({ ...s, marginVPct: 50 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9 6 12 3 15 6"/><polyline points="9 18 12 21 15 18"/></svg>
                </button>
                <button
                  type="button"
                  className="pr-chip"
                  title="Center both"
                  onClick={() => setEffectiveStyle(s => ({ ...s, marginHPct: 0, marginVPct: 50 }))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>
                </button>
              </div>
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('color')}</span>
              <ColorPicker value={effectiveStyle.color}
                           onChange={v => setEffectiveStyle(s => ({ ...s, color: v }))} />
              <label className="pr-check pr-label-mid" title={t('outline')}>
                <input type="checkbox"
                       checked={effectiveStyle.outlineEnabled}
                       onChange={e => setEffectiveStyle(s => ({ ...s, outlineEnabled: e.target.checked }))} />
                <span>{t('outline')}</span>
              </label>
              <ColorPicker value={effectiveStyle.outline}
                           disabled={!effectiveStyle.outlineEnabled}
                           onChange={v => setEffectiveStyle(s => ({ ...s, outline: v }))} />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('outlineWidth')}</span>
              <input type="number" min={0} max={20} step={1}
                     value={effectiveStyle.outlineWidth}
                     disabled={!effectiveStyle.outlineEnabled}
                     onChange={e => setEffectiveStyle(s => ({ ...s, outlineWidth: Math.max(0, +e.target.value) }))}
                     className="pr-input pr-input-num" />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('textCase')}</span>
              <Select
                className="pr-input-flex"
                value={effectiveStyle.textCase}
                onChange={v => setEffectiveStyle(s => ({ ...s, textCase: v as any }))}
                options={[
                  { value: 'asis', label: t('caseAsIs') },
                  { value: 'upper', label: t('caseUpper') },
                  { value: 'lower', label: t('caseLower') },
                ]}
              />
            </div>
            <div className="pr-row">
              <span className="pr-label">{t('maxPerLine')}</span>
              <input type="number" min={1} max={12} value={effectiveStyle.maxWords}
                     onChange={e => setEffectiveStyle(s => ({ ...s, maxWords: +e.target.value }))}
                     className="pr-input pr-input-num" />
            </div>
          </div>
        </div>

        {(proc.phase === 'transcribing' || proc.phase === 'exporting') && (
          <div className="pr-status">
            <div className="pr-progress">
              <div className="pr-progress-bar" style={{ width: `${proc.pct}%` }} />
            </div>
            <pre
              ref={logRef}
              className="pr-log"
              onScroll={e => {
                const el = e.currentTarget;
                logStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
              }}
            >{proc.log}</pre>
          </div>
        )}
        {proc.phase === 'exported' && (
          <div className="pr-toast pr-toast-ok">✓ {proc.outPath}</div>
        )}
        {proc.phase === 'error' && (
          <div className="pr-toast pr-toast-err">✕ {proc.message}</div>
        )}

        <div className="pr-export">
          <div className="pr-export-meta">
            <span className={'pr-pill' + (cropEnabled ? ' on' : '')}>{t('pillCrop')}</span>
            <span className={'pr-pill' + (enabledCount > 0 ? ' on' : '')}>{t('pillSilence')} {enabledCount > 0 ? enabledCount : ''}</span>
            <span className={'pr-pill' + (Math.abs(volumeDb) > 0.01 ? ' on' : '')}>{t('pillAudio')} {Math.abs(volumeDb) > 0.01 ? `${volumeDb > 0 ? '+' : ''}${volumeDb}dB` : ''}</span>
            <span className={'pr-pill' + (cues && cues.length > 0 ? ' on' : '')}>{t('pillSubs')} {cues && cues.length > 0 ? cues.length : ''}</span>
            {splitMarkers.length > 0 && (
              <span className="pr-pill on" title={t('exportPartsHint')}>
                {splitMarkers.length + 1} {t('splitsBadge').toUpperCase()}
              </span>
            )}
          </div>
          {proc.phase === 'exporting' ? (
            <button
              onClick={cancelExportNow}
              disabled={cancellingExport}
              className="pr-export-btn pr-export-btn-cancel"
            >
              {cancellingExport
                ? `${t('exportCancelled').toUpperCase()}`
                : `${t('cancelExport').toUpperCase()} · ${proc.pct.toFixed(0)}%`}
            </button>
          ) : (
            <button
              onClick={exportNow}
              disabled={!videoPath || isBusy}
              className={'pr-export-btn' + (proc.phase === 'exported' ? ' is-done' : '')}
            >
              {proc.phase === 'exported'
                ? `✓ ${t('exportDone').toUpperCase()}`
                : t('exportNow').toUpperCase()}
            </button>
          )}
        </div>
      </aside>
      </div>

      <div
        className={'timeline-preview' + (hoverPreview && videoUrl ? ' is-on' : '')}
        style={
          hoverPreview
            ? {
                left: hoverPreview.clientX,
                top: hoverPreview.topY,
              }
            : undefined
        }
      >
        <div className="timeline-preview-frame">
          <video
            ref={previewVideoRef}
            className="timeline-preview-video"
            muted
            playsInline
            preload="auto"
          />
        </div>
        <div className="timeline-preview-time">
          {hoverPreview ? fmtTime(hoverPreview.time) : ''}
        </div>
      </div>
    </div>
  );
}
