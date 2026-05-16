type SubbiStyle = {
  fontName: string;
  fontSize: number;
  color: string;
  outline: string;
  outlineEnabled: boolean;
  outlineWidth: number;
  marginVPct: number;
  marginHPct: number;
  textCase: 'asis' | 'upper' | 'lower';
  maxWords: number;
};

type SubbiSilenceRange = { start: number; end: number };

type SubbiCropNormalized = {
  x: number; y: number; width: number; height: number;
};

type SubbiDetectSilencesResult = {
  silences: SubbiSilenceRange[];
  duration: number;
  thresholdDb: number;
  meanVolumeDb: number | null;
};

type SubbiProgressEvent =
  | { kind: 'transcribe'; pct: number; line: string }
  | { kind: 'burn'; pct: number; line: string }
  | { kind: 'cut'; pct: number; line: string }
  | { kind: 'export'; pct: number; line: string }
  | { kind: 'modelDownload'; model: 'tiny' | 'medium'; pct: number; line: string };

interface SubbiAPI {
  pickVideo(): Promise<string | null>;
  pathExists(path: string): Promise<boolean>;
  getPathForFile(file: File): string;
  transcribe(opts: {
    videoPath: string;
    language: string;
    model: 'tiny' | 'medium';
    engine?: 'local' | 'openai';
    apiKey?: string;
  }): Promise<{ srtPath: string; srt: string; words?: { word: string; start: number; end: number }[] }>;
  checkModel(model: 'tiny' | 'medium'): Promise<boolean>;
  downloadModel(model: 'tiny' | 'medium'): Promise<boolean>;
  burn(opts: { videoPath: string; srtPath: string; style: SubbiStyle }):
    Promise<string>;
  detectSilences(opts: { videoPath: string; thresholdDb?: number; minDurSec?: number }):
    Promise<SubbiDetectSilencesResult>;
  cutSilences(opts: { videoPath: string; keepRanges: SubbiSilenceRange[] }):
    Promise<string>;
  exportVideo(opts: {
    videoPath: string;
    keepRanges?: SubbiSilenceRange[];
    crop?: SubbiCropNormalized | null;
    cropBgColor?: 'black' | 'white';
    subtitles?: { srtPath: string; style: SubbiStyle } | null;
    volumeDb?: number;
    noiseGateDb?: number | null;
    saturation?: number;
    opacity?: number;
    opacityBgColor?: 'black' | 'white';
    outputPath?: string;
    videoWidth?: number;
    videoHeight?: number;
  }): Promise<string>;
  cancelExport(): Promise<boolean>;
  extractPeaks(opts: { videoPath: string; targetBins?: number }):
    Promise<{ peaks: number[]; duration: number; sampleRate: number }>;
  writeSrt(opts: { srtPath: string; content: string }): Promise<string>;
  setTitleBarOverlay?(opts: { color: string; symbolColor: string }): Promise<boolean>;
  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<{
    current: string;
    latest: string;
    hasUpdate: boolean;
    releaseUrl: string;
    error?: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  onProgress(cb: (evt: SubbiProgressEvent) => void): () => void;
}

interface Window {
  subbi: SubbiAPI;
}
