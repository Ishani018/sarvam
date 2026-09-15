/** Shapes emitted by scripts/build-data.mjs. */

export type Rendering = "digits" | "words" | "absent" | "n/a";

export interface MatrixCell {
  model: string;
  /** Which ASR mode this cell was measured in. In the key, not a caller-side
   *  filter: transcribe and verbatim are the same audio read two ways and a
   *  cell averaging them is a number about neither. */
  mode: string;
  condition: string;
  entityType: string;
  hits: number;
  total: number;
  rate: number | null;
  lowN: boolean;
}

export interface WerRow {
  model: string; mode: string; condition: string; wer: number; n: number;
}

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
  /** In the key rather than another entry in `models`: the row's subject is
   *  whether the recogniser rewrote the number, and `verbatim` by definition
   *  never does. */
  mode: string;
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
  /** The ASR mode every single-number figure on the page describes. Tables
   *  carry every mode and the site switches between them; a headline cannot. */
  primaryMode: string;
  summary: {
    utterances: number; rows: number; entities: number; hits: number;
    hitRate: number | null; conditions: number; models: number;
    /** Rows across every mode, where `rows` counts the primary mode alone. */
    allModeRows: number;
  };
  /** Modes side by side, measured over the cells every mode covers. Verbatim
   *  is usually run on a subset, so comparing each mode's own average would
   *  put a hard subset against an easy one and call it a mode effect. */
  modeCompare: Array<{
    mode: string;
    isPrimary: boolean;
    rows: number; entities: number; hits: number;
    hitRate: number | null; wer: number | null;
    byType: Record<string, { hits: number; total: number }>;
    coverage: {
      sharedCells: number; ownCells: number; conditions: string[];
    };
  }>;
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
    modes: string[]; mode: string; languages: string[]; utterances: number;
  };
  /** The headline finding, derived: the best and worst conditions in the run,
   *  the drop between them, and the interval that makes it a measurement. */
  finding: {
    best: ConditionRate; worst: ConditionRate;
    held: string[];
    points: number | null;
    ci: [number, number] | null;
    nPerCondition: number;
    rates: ConditionRate[];
  } | null;
  /** Both ASR models on identical audio, per condition and pooled over the
   *  bursty ones. `separates` is false when the interval spans zero. */
  modelSplit: {
    models: string[];
    burstyConditions: string[];
    cells: Array<{ condition: string; model: string; hits: number; total: number; rate: number | null }>;
    bursty: Record<string, { model: string; hits: number; total: number; rate: number | null; ci: [number, number] | null }>;
    delta: { points: number; ci: [number, number]; separates: boolean } | null;
  } | null;
  /** Loss conditions whose audio came back identical to the same chain without
   *  the loss step: the random process drew no loss event at all. */
  degenerateDraws: Array<{
    condition: string; base: string; identical: number; utterances: number;
  }>;
  audioBundle: { files: number; bytes: number };
  /** Cue-survival figures from `tee cues --json`, keyed by ASR mode. Null when
   *  no sidecar was present at build time; the section then does not render. */
  cues: {
    byMode: Record<string, CueFigures>;
    sources: string[];
  } | null;
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


export interface CueCondition {
  condition: string;
  cueTotal: number; cueKept: number; cueSurvival: number | null;
  wordTotal: number; wordKept: number; wordSurvival: number | null;
  valuePresent: number;
  orphans: number;
  orphansUnrecovered: number;
  orphansByType: Record<string, number>;
}

export interface CueFigures {
  modes: string[];
  rows: number;
  conditions: CueCondition[];
  orphansByType: Record<string, number>;
  shapedTypes: string[];
  totals: { orphans: number; orphansUnrecovered: number; valuePresent: number };
}

export interface ConditionRate {
  condition: string;
  hits: number;
  total: number;
  rate: number | null;
  ci: [number, number] | null;
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
