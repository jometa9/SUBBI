type SubbiStyle = {
  fontName: string;
  fontSize: number;
  color: string;
  outline: string;
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
  | { kind: 'export'; pct: number; line: string };

interface SubbiAPI {
  pickVideo(): Promise<string | null>;
  getPathForFile(file: File): string;
  transcribe(opts: { videoPath: string; language: string; model: 'tiny' | 'medium' | 'large' }):
    Promise<{ srtPath: string; srt: string }>;
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
    subtitles?: { srtPath: string; style: SubbiStyle } | null;
    volumeDb?: number;
  }): Promise<string>;
  extractPeaks(opts: { videoPath: string; targetBins?: number }):
    Promise<{ peaks: number[]; duration: number; sampleRate: number }>;
  onProgress(cb: (evt: SubbiProgressEvent) => void): () => void;
}

interface Window {
  subbi: SubbiAPI;
}
