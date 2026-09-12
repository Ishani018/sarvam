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
  project: { name: string; script: string; tagline: string };
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
  listen: unknown[];
  method: Record<string, unknown>;
  content: Record<string, string>;
  audioBundle: { files: number; bytes: number };
}
