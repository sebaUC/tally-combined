export type ResolverSource =
  | 'catalog'
  | 'trgm'
  | 'embedding'
  | 'llm'
  | 'user_edit'
  | 'none';

export interface ResolverInput {
  rawDescription: string;
}

export interface ResolverOutput {
  merchantId: string | null;
  name: string;
  logoUrl: string | null;
  defaultCategory: string | null;
  source: ResolverSource;
  latencyMs: number;
  /**
   * True only when this resolve() call inserted a new merchants_global row
   * (i.e. Layer 1d — LLM). Downstream callers use this to emit the
   * `resolver_merchant_created` audit entry. Defaults to undefined/false.
   */
  created?: boolean;
}

export interface LayerResolver {
  readonly source: Exclude<ResolverSource, 'user_edit' | 'none'>;
  resolve(input: ResolverInput): Promise<Omit<ResolverOutput, 'latencyMs'> | null>;
}
