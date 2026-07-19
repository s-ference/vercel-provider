import {
  UnsupportedFunctionalityError,
  type LanguageModelV4CallOptions,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import { z } from 'zod';

import type { SferenceChatTool, SferenceChatToolChoice } from './sference-chat-schemas.js';

export function prepareTools({
  tools,
  toolChoice,
}: {
  tools: LanguageModelV4CallOptions['tools'];
  toolChoice: LanguageModelV4CallOptions['toolChoice'];
}): {
  tools: SferenceChatTool[] | undefined;
  toolChoice: SferenceChatToolChoice | undefined;
  toolWarnings: SharedV4Warning[];
} {
  // Empty tools array → undefined to avoid sending `tools: []`.
  tools = tools?.length ? tools : undefined;

  const toolWarnings: SharedV4Warning[] = [];

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, toolWarnings };
  }

  const sferenceTools: SferenceChatTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'provider') {
      toolWarnings.push({
        type: 'unsupported',
        feature: `provider-defined tool ${tool.id}`,
      });
    } else {
      sferenceTools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema as Record<string, unknown>,
          ...(tool.strict != null ? { strict: tool.strict } : {}),
        },
      });
    }
  }

  if (sferenceTools.length === 0) {
    return { tools: undefined, toolChoice: undefined, toolWarnings };
  }

  if (toolChoice == null) {
    return { tools: sferenceTools, toolChoice: undefined, toolWarnings };
  }

  switch (toolChoice.type) {
    case 'auto':
    case 'none':
    case 'required':
      return { tools: sferenceTools, toolChoice: toolChoice.type, toolWarnings };
    case 'tool':
      return {
        tools: sferenceTools.filter(
          (t) => t.function.name === toolChoice.toolName,
        ),
        toolChoice: { type: 'function', function: { name: toolChoice.toolName } },
        toolWarnings,
      };
    default: {
      const _exhaustiveCheck: never = toolChoice;
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      });
    }
  }
}

// zod schema for providerOptions.sference, validated via parseProviderOptions.
export const sferenceProviderOptionsSchema = z.object({
  serviceTier: z
    .enum(['auto', 'default', 'flex', 'scale', 'priority'])
    .optional(),
  promptCacheKey: z.string().optional(),
  enableThinking: z.boolean().optional(),
});

export type SferenceProviderOptions = z.infer<
  typeof sferenceProviderOptionsSchema
>;
