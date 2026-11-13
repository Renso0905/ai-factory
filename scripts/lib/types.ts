export interface Finding {
  /** Stable rule id, e.g. W001. Documented in docs/STANDARDS.md. */
  rule: string;
  message: string;
  /** Path relative to the checked repository, with forward slashes. */
  file?: string;
  line?: number;
}

export type Mode = 'project' | 'factory';

export interface PolicyOptions {
  /** Directory of the repository being checked. */
  target: string;
  mode: Mode;
  /** owner/name of the central factory, e.g. Renso0905/ai-factory. */
  factoryRepo: string;
  /** Commit the change is compared with for append-only rules (R001). Omitted: R001 is not run. */
  base?: string;
}
