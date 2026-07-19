import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  SharedV4Warning,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  injectJsonInstructionIntoMessages,
  isCustomReasoning,
  parseProviderOptions,
  postJsonToApi,
  serializeModelOptions,
  withUserAgentSuffix,
  WORKFLOW_DESERIALIZE,
  WORKFLOW_SERIALIZE,
  type FetchFunction,
  type ParseResult,
} from '@ai-sdk/provider-utils';

import { convertSferenceUsage } from './convert-sference-usage.js';
import { convertToSferenceChatMessages } from './convert-to-sference-chat-messages.js';
import { getResponseMetadata } from './get-response-metadata.js';
import { mapSferenceFinishReason } from './map-sference-finish-reason.js';
import {
  prepareTools,
  sferenceProviderOptionsSchema,
  type SferenceProviderOptions,
} from './sference-prepare-tools.js';
import {
  sferenceChatChunkSchema,
  sferenceChatResponseSchema,
  type SferenceChatChunk,
  type SferenceChatStreamToolCallDelta,
} from './sference-chat-schemas.js';
import { sferenceFailedResponseHandler } from './sference-error.js';
import { VERSION } from './version.js';

export type SferenceChatConfig = {
  provider: string;
  baseURL: string;
  headers?: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  generateId?: () => string;
};

/**
 * `LanguageModelV4` implementation backed by sference's OpenAI-compatible
 * `/v1/chat/completions` endpoint (realtime sync + SSE streaming).
 */
export class SferenceChatLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly modelId: string;

  private readonly config: SferenceChatConfig;
  private readonly generateId: () => string;

  static [WORKFLOW_SERIALIZE](model: SferenceChatLanguageModel) {
    return serializeModelOptions({
      modelId: model.modelId,
      config: model.config,
    });
  }

  static [WORKFLOW_DESERIALIZE](options: {
    modelId: string;
    config: SferenceChatConfig;
  }) {
    return new SferenceChatLanguageModel(options.modelId, options.config);
  }

  constructor(modelId: string, config: SferenceChatConfig) {
    this.modelId = modelId;
    this.config = config;
    this.generateId = config.generateId ?? generateId;
  }

  get provider(): string {
    return this.config.provider;
  }

  readonly supportedUrls: Record<string, RegExp[]> = {
    // sference ingests image URLs server-side; declare http(s) image URLs as
    // natively supported so the AI SDK doesn't pre-download them.
    'image/*': [/^https?:\/\/.+/],
  };

  private async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    reasoning,
    stopSequences,
    responseFormat,
    seed,
    providerOptions,
    tools,
    toolChoice,
  }: LanguageModelV4CallOptions): Promise<{
    args: Record<string, unknown>;
    warnings: SharedV4Warning[];
  }> {
    const warnings: SharedV4Warning[] = [];

    const options =
      (await parseProviderOptions({
        provider: 'sference',
        providerOptions,
        schema: sferenceProviderOptionsSchema,
      })) ?? {};

    if (topK != null) {
      warnings.push({ type: 'unsupported', feature: 'topK' });
    }
    if (frequencyPenalty != null) {
      warnings.push({ type: 'unsupported', feature: 'frequencyPenalty' });
    }
    if (presencePenalty != null) {
      warnings.push({ type: 'unsupported', feature: 'presencePenalty' });
    }

    // For json_object (no schema), instruct the model to return JSON, matching
    // the OpenAI/Mistral convention.
    if (responseFormat?.type === 'json' && responseFormat.schema == null) {
      prompt = injectJsonInstructionIntoMessages({
        messages: prompt,
        schema: responseFormat.schema,
      });
    }

    // Map the SDK's reasoning level to sference's `enable_thinking`, but only
    // when the caller hasn't set `enableThinking` explicitly via provider
    // options (provider options win). sference's flag is boolean, so any
    // non-"none" custom reasoning level enables thinking.
    let enableThinking = options.enableThinking;
    if (enableThinking === undefined && isCustomReasoning(reasoning)) {
      enableThinking = reasoning !== 'none';
    }

    const baseArgs = {
      model: this.modelId,
      max_tokens: maxOutputTokens,
      temperature,
      top_p: topP,
      stop: stopSequences,
      seed,
      response_format:
        responseFormat?.type === 'json'
          ? responseFormat.schema != null
            ? {
                type: 'json_schema',
                json_schema: {
                  schema: responseFormat.schema,
                  ...(responseFormat.name != null ? { name: responseFormat.name } : {}),
                  ...(responseFormat.description != null
                    ? { description: responseFormat.description }
                    : {}),
                },
              }
            : { type: 'json_object' }
          : undefined,
      // sference-specific pass-through fields:
      service_tier: options.serviceTier,
      prompt_cache_key: options.promptCacheKey,
      enable_thinking: enableThinking,
      messages: convertToSferenceChatMessages(prompt),
    };

    const { tools: sferenceTools, toolChoice: sferenceToolChoice, toolWarnings } =
      prepareTools({ tools, toolChoice });

    return {
      args: {
        ...baseArgs,
        tools: sferenceTools,
        tool_choice: sferenceToolChoice,
      },
      warnings: [...warnings, ...toolWarnings],
    };
  }

  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const { args, warnings } = await this.getArgs(options);
    const body = { ...args, stream: false };

    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers?.(), options.headers),
      body,
      failedResponseHandler: sferenceFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(sferenceChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = response.choices[0];
    if (choice == null) {
      throw new Error('sference returned no completion choices');
    }
    const content: Array<LanguageModelV4Content> = [];

    if (typeof choice.message.reasoning_content === 'string' && choice.message.reasoning_content.length > 0) {
      content.push({ type: 'reasoning', text: choice.message.reasoning_content });
    }
    if (typeof choice.message.content === 'string' && choice.message.content.length > 0) {
      content.push({ type: 'text', text: choice.message.content });
    }
    if (choice.message.tool_calls != null) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
        });
      }
    }

    return {
      content,
      finishReason: mapSferenceFinishReason(choice.finish_reason),
      usage: convertSferenceUsage(response.usage ?? undefined),
      providerMetadata:
        response.service_tier != null
          ? { sference: { serviceTier: response.service_tier } }
          : undefined,
      request: { body },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    };
  }

  async doStream(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    const { args, warnings } = await this.getArgs(options);
    const body = { ...args, stream: true, stream_options: { include_usage: true } };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers?.(), options.headers),
      body,
      failedResponseHandler: sferenceFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(sferenceChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV4FinishReason = {
      unified: 'other',
      raw: undefined,
    };
    let usage: SferenceChatChunk['usage'] = undefined;

    let isFirstChunk = true;
    let activeText = false;
    let activeReasoningId: string | null = null;
    const toolCallState = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();
    let emittedToolCalls = false;

    const generateId = this.generateId;

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<SferenceChatChunk>,
          LanguageModelV4StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings });
          },

          transform(chunk, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
            }

            if (!chunk.success) {
              controller.enqueue({ type: 'error', error: chunk.error });
              return;
            }

            const value = chunk.value;

            if (isFirstChunk) {
              isFirstChunk = false;
              controller.enqueue({
                type: 'response-metadata',
                ...getResponseMetadata(value),
              });
            }

            if (value.usage != null) {
              usage = value.usage;
            }

            const choice = value.choices?.[0];

            // Terminal usage-only chunk (choices: []): this is where we emit the
            // deferred `finish` with real usage, since we set include_usage.
            if (choice == null) {
              return;
            }

            const delta = choice.delta;

            // Reasoning deltas.
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
              if (activeReasoningId == null) {
                // End any active text before starting reasoning.
                if (activeText) {
                  controller.enqueue({ type: 'text-end', id: '0' });
                  activeText = false;
                }
                activeReasoningId = generateId();
                controller.enqueue({ type: 'reasoning-start', id: activeReasoningId });
              }
              controller.enqueue({
                type: 'reasoning-delta',
                id: activeReasoningId,
                delta: delta.reasoning_content,
              });
            }

            // Content deltas.
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (!activeText) {
                // End reasoning before starting text.
                if (activeReasoningId != null) {
                  controller.enqueue({ type: 'reasoning-end', id: activeReasoningId });
                  activeReasoningId = null;
                }
                controller.enqueue({ type: 'text-start', id: '0' });
                activeText = true;
              }
              controller.enqueue({ type: 'text-delta', id: '0', delta: delta.content });
            }

            // Tool-call deltas (correlated by `index`).
            if (delta.tool_calls != null) {
              for (const tc of delta.tool_calls) {
                handleToolCallDelta(tc, controller, toolCallState);
              }
            }

            // Finish reason arrives on the final content chunk. Close open
            // parts and emit tool-calls now; the `finish` event is emitted in
            // `flush` once the trailing usage-only chunk has been seen.
            if (choice.finish_reason != null) {
              finishReason = mapSferenceFinishReason(choice.finish_reason);
              if (activeReasoningId != null) {
                controller.enqueue({ type: 'reasoning-end', id: activeReasoningId });
                activeReasoningId = null;
              }
              if (activeText) {
                controller.enqueue({ type: 'text-end', id: '0' });
                activeText = false;
              }
              if (!emittedToolCalls) {
                for (const [, tc] of toolCallState) {
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: tc.id ?? '',
                    toolName: tc.name ?? '',
                    input: tc.args,
                  });
                }
                emittedToolCalls = true;
              }
            }
          },

          flush(controller) {
            if (activeReasoningId != null) {
              controller.enqueue({ type: 'reasoning-end', id: activeReasoningId });
            }
            if (activeText) {
              controller.enqueue({ type: 'text-end', id: '0' });
            }
            if (!emittedToolCalls) {
              for (const [, tc] of toolCallState) {
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: tc.id ?? '',
                  toolName: tc.name ?? '',
                  input: tc.args,
                });
              }
            }
            controller.enqueue({
              type: 'finish',
              finishReason,
              usage: convertSferenceUsage(usage ?? undefined),
            });
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}

function handleToolCallDelta(
  tc: SferenceChatStreamToolCallDelta,
  controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
  state: Map<number, { id?: string; name?: string; args: string }>,
): void {
  const existing = state.get(tc.index);
  const isFirst = existing === undefined;
  const entry = existing ?? { args: '' };

  if (tc.id != null) entry.id = tc.id;
  if (tc.function?.name != null && tc.function.name.length > 0) entry.name = tc.function.name;
  if (tc.function?.arguments != null) entry.args += tc.function.arguments;

  if (isFirst) {
    state.set(tc.index, entry);
    controller.enqueue({
      type: 'tool-input-start',
      id: entry.id ?? `tool-${tc.index}`,
      toolName: entry.name ?? '',
    });
  }

  if (tc.function?.arguments != null && tc.function.arguments.length > 0) {
    controller.enqueue({
      type: 'tool-input-delta',
      id: entry.id ?? `tool-${tc.index}`,
      delta: tc.function.arguments,
    });
  }
}

// Re-export so consumers can import the provider-options type from one place.
export type { SferenceProviderOptions };
