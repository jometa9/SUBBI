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

type SubbiProgressEvent =
  | { kind: 'transcribe'; pct: number; line: string }
  | { kind: 'burn'; pct: number; line: string };

interface SubbiAPI {
  pickVideo(): Promise<string | null>;
  getPathForFile(file: File): string;
  transcribe(opts: { videoPath: string; language: string; model: 'tiny' | 'medium' | 'large' }):
    Promise<{ srtPath: string; srt: string }>;
  burn(opts: { videoPath: string; srtPath: string; style: SubbiStyle }):
    Promise<string>;
  onProgress(cb: (evt: SubbiProgressEvent) => void): () => void;
}

interface Window {
  subbi: SubbiAPI;
}
