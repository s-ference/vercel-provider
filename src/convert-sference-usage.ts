import type { LanguageModelV4Usage } from '@ai-sdk/provider';

export type SferenceUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: {
    reasoning_tokens?: number | null;
  } | null;
  prompt_tokens_details?: {
    cached_tokens?: number | null;
  } | null;
};

export function convertSferenceUsage(
  usage: SferenceUsage | undefined | null,
): LanguageModelV4Usage {
  if (usage == null) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    };
  }

  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cacheReadTokens,
      cacheRead: cacheReadTokens || undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text:
        reasoningTokens != null
          ? Math.max(0, completionTokens - reasoningTokens)
          : completionTokens,
      reasoning: reasoningTokens ?? undefined,
    },
    raw: usage as unknown as import('@ai-sdk/provider').JSONObject,
  };
}
