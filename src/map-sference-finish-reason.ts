import type { LanguageModelV4FinishReason } from '@ai-sdk/provider';

/**
 * Map an OpenAI/sference `finish_reason` to the AI SDK v4 unified finish reason.
 *
 * sference emits standard OpenAI finish reasons: `stop`, `length`,
 * `tool_calls`, `content_filter`. Anything else maps to `other`.
 */
export function mapSferenceFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV4FinishReason {
  let unified: LanguageModelV4FinishReason['unified'];
  switch (finishReason) {
    case 'stop':
      unified = 'stop';
      break;
    case 'length':
      unified = 'length';
      break;
    case 'tool_calls':
      unified = 'tool-calls';
      break;
    case 'content_filter':
      unified = 'content-filter';
      break;
    case 'error':
      unified = 'error';
      break;
    default:
      unified = 'other';
  }
  return { unified, raw: finishReason ?? undefined };
}
