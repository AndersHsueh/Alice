/**
 * Shim for @google/genai
 * Provides type stubs needed by the qwen-code UI layer.
 */

export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: FunctionCall }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type PartUnion = Part | string;
export type PartListUnion = PartUnion | PartUnion[];

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface Content {
  role: string;
  parts: Part[];
}

export enum FinishReason {
  FINISH_REASON_UNSPECIFIED = 'FINISH_REASON_UNSPECIFIED',
  STOP = 'STOP',
  MAX_TOKENS = 'MAX_TOKENS',
  SAFETY = 'SAFETY',
  RECITATION = 'RECITATION',
  OTHER = 'OTHER',
}

export interface GenerateContentResponseUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}
