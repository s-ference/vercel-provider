import type { FetchFunction } from '@ai-sdk/provider-utils';

export type SferenceProviderSettings = {
  /**
   * Base URL for the sference API. Defaults to `https://api.sference.com/v1`
   * (the OpenAI-compatible surface). For self-hosted deployments, point this
   * at your API origin with a `/v1` suffix.
   */
  baseURL?: string;
  /** API key. Falls back to the `SFERENCE_API_KEY` environment variable. */
  apiKey?: string;
  /** Extra headers merged into every request (after auth). */
  headers?: Record<string, string | undefined>;
  /** Custom fetch implementation (e.g. for tests or edge runtimes). */
  fetch?: FetchFunction;
  /** Custom id generator for stream part ids. */
  generateId?: () => string;
};
