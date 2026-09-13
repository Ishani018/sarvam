/** Shapes emitted by scripts/build-data.mjs. */

export type Rendering = "digits" | "words" | "absent" | "n/a";

export interface MatrixCell {
  model: string;
  condition: string;
  entityType: string;
  hits: number;
  total: number;
  rate: number | null;
  lowN: boolean;
}

export interface WerRow { model: string; condition: string; wer: number; n: number; }

export interface RenderingModel {
  model: string;
  mode: string | null;
  rendering: Rendering;
  hit: boolean;
  wer: number;
  hypothesis: string;
}

export interface RenderingRow {
  utteranceId: string;
  condition: string;
  entityType: string;
  expected: string;
  reference: string;
  referenceRendering: string | null;
  models: RenderingModel[];
}

export interface ConditionDef {
  name: string;
  description: string;
  chain: Array<Record<string, unknown>>;
  exercised: boolean;
  commands: Array<{ argv: string[]; note: string; isShell: boolean }>;
  tools: Record<string, string>;
  seed: number | null;
  durationS: number | null;
}

export interface RunMeta {
  runId: string;
  source: string;
  asrImpls: string[];
  models: string[];
  modes: string[];
  languages: string[];
  conditions: string[];
  nUtterances: number;
  nRows: number;
  nEntities: number;
  nErrors: number;
}

export interface GintiData {
  generatedAt: string;
  project: { name: string; script: string; tagline: string; repo: string | null };
  provenance: {
    isMock: boolean;
    asrImpls: string[];
    warnings: string[];
    sourceFiles: { results: string[]; corpora: string[]; config: string };
  };
  runs: RunMeta[];
  models: string[];
  modes: string[];
  conditions: ConditionDef[];
  entityTypes: string[];
  summary: {
    utterances: number; rows: number; entities: number; hits: number;
    hitRate: number | null; conditions: number; models: number;
  };
  matrix: MatrixCell[];
  lowNThreshold: number;
  werSpread: {
    min: { wer: number; model: string; id: string };
    max: { wer: number; model: string; id: string };
  };
  wer: WerRow[];
  rendering: RenderingRow[];
  renderingStats: {
    pairs: number; disagreements: number; selfFlips: number;
    rewrote: number; models: number;
  };
  listen: ListenEntry[];
  method: Record<string, unknown>;
  content: Record<string, { summary: string | null; body: string }>;
  lossPairs: Array<{
    rate: number;
    meanBurstMs: number | null;
    scattered: LossSide;
    bursty: LossSide;
  }>;
  headline: {
    hits: number; entities: number; hitRate: number | null;
    werByModel: Array<{ model: string; wer: number; n: number }>;
    werConditionMin: number | null; werConditionMax: number | null;
    conditions: number; declaredConditions: number; models: number;
    modes: string[]; languages: string[]; utterances: number;
  };
  audioBundle: { files: number; bytes: number };
  /** What the run spent on the two Sarvam endpoints. Counts exact; seconds and
   *  cost estimated, and labelled as such wherever they are shown. */
  usage: {
    tts: {
      endpoint: string | null; model: string | null; speaker: string | null;
      sampleRate: number | null; calls: number; chars: number;
    };
    asr: {
      endpoint: string | null; models: string[]; modes: string[];
      calls: number; audioFiles: number;
    };
    estimatedAudioSeconds: number;
    estimatedCostInr: number;
    rates: { asrInrPerAudioSecond: number | null; ttsInrPer1kChars: number | null };
    charsPerSecond: number;
  } | null;
}


export interface ListenEntity {
  type: string;
  surface: string;
  normalized: string;
  start: number | null;
  end: number | null;
}

export interface ListenResultEntity {
  type: string;
  expected: string;
  expectedSurface: string;
  found: string | null;
  foundSurface: string | null;
  hit: boolean;
  editDistance: number | null;
  rendering?: Rendering;
}

export interface ListenResult {
  model: string;
  mode: string | null;
  hypothesis: string;
  wer: number;
  error: string | null;
  entities: ListenResultEntity[];
}

export interface ListenCondition {
  condition: string;
  audio: string | null;
  sizeBytes: number | null;
  peaks: number[] | null;
  durationS: number | null;
  results: ListenResult[];
}

export interface ListenEntry {
  utteranceId: string;
  language: string;
  text: string;
  gloss: string | null;
  templateId: string | null;
  realization: string | null;
  domain: string | null;
  codeMixed: boolean;
  entities: ListenEntity[];
  conditions: ListenCondition[];
}


export interface LossSide {
  condition: string;
  hits: number;
  total: number;
  wer: number | null;
  accounts: { hits: number; total: number };
}
