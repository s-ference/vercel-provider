import {
  NoSuchModelError,
  type EmbeddingModelV4,
  type LanguageModelV4,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  loadApiKey,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from '@ai-sdk/provider-utils';

import {
  SferenceChatLanguageModel,
  type SferenceChatConfig,
} from './sference-chat-language-model.js';
import type { SferenceProviderSettings } from './sference-provider-options.js';
import { VERSION } from './version.js';

/**
 * sference AI SDK provider.
 *
 * Call it as a function to get a chat language model:
 *
 * ```ts
 * import { sference } from '@sference/vercel-provider';
 *
 * const model = sference('Qwen/Qwen3.6-35B-A3B');
 * ```
 *
 * Or via the explicit `languageModel` method.
 */
export interface SferenceProvider extends ProviderV4 {
  specificationVersion: 'v4';
  (modelId: string): LanguageModelV4;

  /** Creates a model for text generation. */
  languageModel(modelId: string): LanguageModelV4;

  /** Alias for `languageModel`. */
  chat(modelId: string): LanguageModelV4;
}

/**
 * Create a sference provider instance with custom settings.
 */
export function createSference(
  options: SferenceProviderSettings = {},
): SferenceProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? 'https://api.sference.com/v1';

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'SFERENCE_API_KEY',
          description: 'sference',
        })}`,
        ...options.headers,
      },
      `ai-sdk/sference/${VERSION}`,
    );

  const createChatModel = (modelId: string) =>
    new SferenceChatLanguageModel(modelId, {
      provider: 'sference.chat',
      baseURL,
      headers: getHeaders,
      ...(options.fetch != null ? { fetch: options.fetch } : {}),
      ...(options.generateId != null ? { generateId: options.generateId } : {}),
    });

  const provider = function (modelId: string) {
    if (new.target) {
      throw new Error(
        'The sference model function cannot be called with the new keyword.',
      );
    }
    return createChatModel(modelId);
  } as unknown as SferenceProvider;

  provider.specificationVersion = 'v4' as const;
  provider.languageModel = createChatModel;
  provider.chat = createChatModel;

  provider.embeddingModel = (modelId: string): EmbeddingModelV4 => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  };

  return provider;
}

/**
 * Default sference provider instance, reading `SFERENCE_API_KEY` from the
 * environment and targeting `https://api.sference.com/v1`.
 */
export const sference: SferenceProvider = createSference();

export type { SferenceChatConfig, SferenceProviderSettings };
