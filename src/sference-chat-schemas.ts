import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request-side types (OpenAI-compatible chat completions request body)
// ---------------------------------------------------------------------------

export interface SferenceChatTextPart {
  type: 'text';
  text: string;
}

export interface SferenceChatImageUrlPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type SferenceChatContentPart = SferenceChatTextPart | SferenceChatImageUrlPart;

export interface SferenceChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface SferenceChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | SferenceChatContentPart[] | null;
  tool_calls?: SferenceChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export type SferenceChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface SferenceChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

// Limited schemas focused on what the implementation needs. Keeping them
// permissive limits breakage when the sference API adds fields, and matches
// the Mistral reference provider's approach.

const sferenceToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const sferenceContentSchema = z
  .union([
    z.string(),
    z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({
          type: z.literal('image_url'),
          image_url: z.union([
            z.string(),
            z.object({ url: z.string(), detail: z.string().nullish() }),
          ]),
        }),
      ]),
    ),
  ])
  .nullish();

const sferenceUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  completion_tokens_details: z
    .object({ reasoning_tokens: z.number().nullish() })
    .nullish(),
  prompt_tokens_details: z
    .object({ cached_tokens: z.number().nullish() })
    .nullish(),
});

export type SferenceUsage = z.infer<typeof sferenceUsageSchema>;

// Non-streaming chat.completion response.
export const sferenceChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  object: z.literal('chat.completion'),
  service_tier: z.string().nullish(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.literal('assistant'),
        content: sferenceContentSchema,
        reasoning_content: z.string().nullish(),
        refusal: z.string().nullish(),
        tool_calls: z.array(sferenceToolCallSchema).nullish(),
      }),
      finish_reason: z.string().nullish(),
      logprobs: z.unknown().nullish(),
    }),
  ),
  usage: sferenceUsageSchema.nullish(),
});

// Streaming chat.completion.chunk.
const sferenceStreamToolCallSchema = z.object({
  index: z.number(),
  id: z.string().nullish(),
  type: z.literal('function').nullish(),
  function: z.object({
    name: z.string().nullish(),
    arguments: z.string().nullish(),
  }),
});

export const sferenceChatChunkSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  object: z.literal('chat.completion.chunk'),
  service_tier: z.string().nullish(),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        role: z.literal('assistant').nullish(),
        content: z.string().nullish(),
        reasoning_content: z.string().nullish(),
        tool_calls: z.array(sferenceStreamToolCallSchema).nullish(),
      }),
      finish_reason: z.string().nullish(),
      logprobs: z.unknown().nullish(),
    }),
  ),
  usage: sferenceUsageSchema.nullish(),
});

export type SferenceChatStreamToolCallDelta = NonNullable<
  NonNullable<SferenceChatChunk['choices'][number]['delta']['tool_calls']
>[number]>;

export type SferenceChatCompletion = z.infer<typeof sferenceChatResponseSchema>;
export type SferenceChatChunk = z.infer<typeof sferenceChatChunkSchema>;
