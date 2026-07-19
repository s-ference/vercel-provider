import {
  UnsupportedFunctionalityError,
  type LanguageModelV4FilePart,
  type LanguageModelV4Prompt,
  type LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import {
  convertToBase64,
  getTopLevelMediaType,
  resolveFullMediaType,
} from '@ai-sdk/provider-utils';

import type {
  SferenceChatContentPart,
  SferenceChatImageUrlPart,
  SferenceChatMessage,
} from './sference-chat-schemas.js';

/**
 * sference chat-completions message shape. Mirrors the server-side
 * `ChatMessage` (OpenAI-compatible).
 */
export type SferencePrompt = SferenceChatMessage[];

/**
 * Convert an AI SDK v4 prompt into the sference chat-completions `messages`
 * array.
 *
 * sference is OpenAI-compatible, so this is a straightforward mapping. The one
 * structural difference: the AI SDK models a `tool` message as a message whose
 * content is an array of tool-result parts, whereas OpenAI chat uses one `tool`
 * message per result (with `tool_call_id`). We expand accordingly.
 */
export function convertToSferenceChatMessages(
  prompt: LanguageModelV4Prompt,
): SferencePrompt {
  const messages: SferencePrompt = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        messages.push({ role: 'system', content: message.content });
        break;
      }

      case 'user': {
        const textParts: string[] = [];
        const contentParts: SferenceChatContentPart[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'file') {
            const imagePart = convertFilePartToImageContent(part);
            if (imagePart !== undefined) contentParts.push(imagePart);
          }
        }
        // Plain string is the common, cheapest path; only emit a multimodal
        // content array when there are image parts.
        if (contentParts.length === 0) {
          messages.push({ role: 'user', content: textParts.join('') });
        } else {
          const arr: SferenceChatContentPart[] = [];
          if (textParts.length > 0) arr.push({ type: 'text', text: textParts.join('') });
          arr.push(...contentParts);
          messages.push({ role: 'user', content: arr });
        }
        break;
      }

      case 'assistant': {
        const textParts: string[] = [];
        const toolCalls: NonNullable<SferenceChatMessage['tool_calls']> = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'tool-call') {
            toolCalls.push({
              id: part.toolCallId,
              type: 'function',
              function: {
                name: part.toolName,
                arguments:
                  typeof part.input === 'string'
                    ? part.input
                    : JSON.stringify(part.input ?? {}),
              },
            });
          }
          // `reasoning` parts are model-internal CoT and are not replayed to
          // the engine as content; the engine regenerates its own.
        }
        const assistantMessage: SferenceChatMessage = {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('') : null,
        };
        if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
        messages.push(assistantMessage);
        break;
      }

      case 'tool': {
        // One OpenAI `tool` message per tool-result part.
        for (const toolResponse of message.content) {
          if (toolResponse.type === 'tool-approval-response') continue;
          messages.push({
            role: 'tool',
            tool_call_id: toolResponse.toolCallId,
            name: toolResponse.toolName,
            content: serializeToolResult(toolResponse.output),
          });
        }
        break;
      }

      default: {
        const _exhaustiveCheck: never = message;
        throw new Error(`Unsupported message role: ${_exhaustiveCheck}`);
      }
    }
  }

  return messages;
}

function convertFilePartToImageContent(
  part: LanguageModelV4FilePart,
): SferenceChatImageUrlPart | undefined {
  const topLevel = getTopLevelMediaType(part.mediaType);
  if (topLevel !== 'image') {
    // sference chat completions accept image inputs only (PDFs go via the
    // Responses surface). Surface the limitation rather than silently dropping.
    throw new UnsupportedFunctionalityError({
      functionality: `file parts of type ${part.mediaType} (only image/* supported on chat completions)`,
    });
  }

  switch (part.data.type) {
    case 'reference':
      throw new UnsupportedFunctionalityError({
        functionality: 'file parts with provider references',
      });
    case 'text':
      throw new UnsupportedFunctionalityError({
        functionality: 'text file parts',
      });
    case 'url':
      return { type: 'image_url', image_url: { url: part.data.url.toString() } };
    case 'data': {
      const mediaType = resolveFullMediaType({ part });
      const data =
        part.data.data instanceof Uint8Array
          ? convertToBase64(part.data.data)
          : part.data.data;
      const url = data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`;
      return { type: 'image_url', image_url: { url } };
    }
    default: {
      const _exhaustiveCheck: never = part.data;
      throw new UnsupportedFunctionalityError({
        functionality: `file part data type ${_exhaustiveCheck}`,
      });
    }
  }
}

function serializeToolResult(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return output.reason ?? 'Tool call execution denied.';
    case 'content': {
      return output.value
        .filter((p): p is { type: 'text'; text: string } =>
          p.type === 'text' && typeof p.text === 'string',
        )
        .map((p) => p.text)
        .join('');
    }
    default: {
      const _exhaustiveCheck: never = output;
      return '';
    }
  }
}
