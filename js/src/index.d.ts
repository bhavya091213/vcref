export const MAGIC: "VCREF1";
export const VERSION: 1;

export class VcrefError extends Error {}

export interface ClipMeta {
  file: string;
  text: string;
  seconds?: number;
  label?: string;
  source?: string;
  sample_rate?: number;
  sha256: string;
}

export interface Rule {
  pattern: string;
  tag: string;
}

/** See SPEC.md, "cadence". Every member is optional. */
export interface CadenceStats {
  seconds?: number;
  syll?: number;
  artic?: number;
  rate?: number;
  pauses?: Record<string, { n: number; med: number; p90: number }>;
  final?: number;
  lead?: number[];
  db?: number;
  sentence_gap?: { n: number; med: number; p25: number; p90: number };
  f0?: { med: number; spread: number; sd: number };
  [k: string]: unknown;
}

export interface Cadence {
  v?: number;
  global?: CadenceStats;
  tags?: Record<string, CadenceStats>;
  sections?: Record<string, CadenceStats>;
}

export interface Manifest {
  format: "vcref";
  version: number;
  name: string;
  created?: string;
  default: string;
  clips: Record<string, ClipMeta>;
  rules?: Rule[];
  config?: Record<string, unknown>;
  parts?: Record<string, { file: string; seconds?: number; sha256: string }>;
  cadence?: Cadence;
  [k: string]: unknown;
}

export interface Clip {
  tag: string;
  text: string;
  seconds: number | null;
  label: string | null;
  sampleRate: number | null;
  flac: Uint8Array;
}

export class Bundle {
  manifest: Manifest;
  static fromBytes(bytes: Uint8Array | ArrayBuffer): Promise<Bundle>;
  /** Node only. */
  static open(path: string): Promise<Bundle>;
  readonly name: string;
  readonly default: string;
  readonly config: Record<string, unknown>;
  readonly tags: string[];
  readonly parts: string[];
  readonly cadence: Cadence | null;
  id(): Promise<string>;
  rules(): { pattern: RegExp; tag: string }[];
  selectTag(text: string): string;
  clip(tag?: string): Promise<Clip>;
  part(name: string): Promise<Uint8Array>;
  verify(): Promise<true>;
}

export interface PackOptions {
  clips: Record<string, { text: string; flac: Uint8Array | ArrayBuffer; label?: string; source?: string; seconds?: number }>;
  name?: string;
  defaultTag?: string;
  rules?: Rule[];
  config?: Record<string, unknown>;
  cadence?: Cadence | null;
  parts?: Record<string, { flac: Uint8Array | ArrayBuffer; seconds?: number }>;
}

export function pack(options: PackOptions): Promise<Uint8Array>;
export function crc32(buf: Uint8Array): number;
