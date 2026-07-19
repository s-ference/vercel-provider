# `@sference/vercel-provider`

A [Vercel AI SDK](https://ai-sdk.dev) v4 provider for the [sference](https://sference.com) managed-inference API.

sference exposes an OpenAI-compatible `/v1/chat/completions` endpoint with realtime sync and SSE streaming for open-weight models (Qwen, GLM, DeepSeek, Kimi, …). This provider maps that surface onto the AI SDK [`LanguageModelV4`](https://ai-sdk.dev/providers/community-providers/custom-providers) specification, so `generateText`, `streamText`, `generateObject`, `streamObject`, and agents all work out of the box.

> Realtime only. Async (background `/v1/responses` with `15m`/`1h`/`24h` completion windows), streams, and batches are served by the `sference-sdk` Python package and CLI — a future provider release will expose them as a separate mode.

## Install

```bash
npm install @sference/vercel-provider
# peer deps:
npm install ai zod
```

## Setup

Set your API key (get one at [app.sference.com](https://app.sference.com)):

```bash
export SFERENCE_API_KEY=sk_...
```

## Usage

```ts
import { sference } from '@sference/vercel-provider';
import { generateText, streamText } from 'ai';

const model = sference('Qwen/Qwen3.6-35B-A3B');

// Non-streaming
const { text } = await generateText({
  model,
  prompt: 'Say hello in one sentence.',
});

// Streaming
const { textStream } = streamText({
  model,
  prompt: 'Write a haiku about GPUs.',
});
for await (const delta of textStream) process.stdout.write(delta);
```

### Structured output

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: sference('Qwen/Qwen3.6-35B-A3B'),
  schema: z.object({ city: z.string(), country: z.string() }),
  prompt: 'Return the capital of Slovenia.',
});
```

### Tool calling

```ts
import { generateText, tool } from 'ai';
import { z } from 'zod';

const { toolCalls, toolResults } = await generateText({
  model: sference('Qwen/Qwen3.6-35B-A3B'),
  tools: {
    get_weather: tool({
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => `sunny in ${city}`,
    }),
  },
  prompt: 'What is the weather in Ljubljana?',
});
```

### Reasoning models

Chain-of-thought (`reasoning_content` from Qwen3, GLM, Kimi, …) is emitted as AI SDK `reasoning` parts, available via `result.reasoningText` (`generateText`) and `result.reasoning` (`streamText`).

Control it with the standard AI SDK `reasoning` option — `none` disables thinking, any other level enables it:

```ts
import { generateText } from 'ai';

await generateText({
  model: sference('Qwen/Qwen3.6-35B-A3B'),
  prompt: 'Solve this step by step.',
  reasoning: 'high', // enables thinking
});
```

`providerOptions.sference.enableThinking` takes precedence over the `reasoning` option when both are set.

### Provider options

Pass sference-specific fields via `providerOptions.sference`:

```ts
await generateText({
  model: sference('Qwen/Qwen3.6-35B-A3B'),
  prompt: 'Hello',
  providerOptions: {
    sference: {
      serviceTier: 'flex',      // discounted, lower-priority tier
      promptCacheKey: 'sess-1', // pin a conversation to one warm worker
      enableThinking: false,    // disable CoT on reasoning models
    },
  },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `serviceTier` | `'auto' \| 'default' \| 'flex' \| 'scale' \| 'priority'` | Processing tier. Only `flex` changes behavior (discounted tokens, lower priority, best-effort). |
| `promptCacheKey` | `string` | Stable id routing requests with the same key to the same warm worker for prompt-cache reuse. |
| `enableThinking` | `boolean` | Explicitly enable/disable thinking on reasoning models. |

## Configuration

```ts
import { createSference } from '@sference/vercel-provider';

const sference = createSference({
  baseURL: 'https://api.sference.com/v1', // default; set for self-hosted
  apiKey: process.env.SFERENCE_API_KEY,   // default reads SFERENCE_API_KEY
  headers: { 'X-Title': 'my-app' },       // optional extra headers
});
```

| Setting | Default | Description |
|---------|---------|-------------|
| `baseURL` | `https://api.sference.com/v1` | API base URL. For self-hosted, point at your origin with a `/v1` suffix. |
| `apiKey` | `process.env.SFERENCE_API_KEY` | API key. Sent as `Authorization: Bearer …`. |
| `headers` | — | Extra headers merged into every request. |
| `fetch` | global `fetch` | Custom fetch (tests, edge runtimes, proxies). |

## Supported features

| Feature | Support |
|---------|---------|
| `generateText` / `streamText` | ✅ |
| `generateObject` / `streamObject` (JSON schema + json_object) | ✅ |
| Tool calling (function tools) | ✅ |
| Multi-turn tool results | ✅ |
| Multimodal image input (`image_url`) | ✅ |
| Reasoning (`reasoning_content`) | ✅ |
| `service_tier: flex` | ✅ |
| Prompt cache routing (`prompt_cache_key`) | ✅ |
| `topK`, `presencePenalty`, `frequencyPenalty` | ⚠️ ignored with a warning |
| Provider-defined tools | ⚠️ dropped with a warning |
| Async / batch / streams | ❌ (use `sference-sdk`; planned) |

## License

Apache-2.0 — see [LICENSE](./LICENSE).
