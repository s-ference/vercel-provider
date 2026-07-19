# Project notes — `@sference/vercel-provider`

A [Vercel AI SDK](https://ai-sdk.dev) v4 (`LanguageModelV4`) provider for the
[sference](https://sference.com) realtime inference API. The provider wraps the
OpenAI-compatible `POST /v1/chat/completions` endpoint (sync + SSE streaming) and
maps it onto the AI SDK v4 spec so `generateText`, `streamText`, `generateObject`,
`streamObject`, and agents work out of the box.

> Realtime only in this release. Async (background `/v1/responses` with
> `15m`/`1h`/`24h` completion windows), streams, and batches are served by the
> Python [`sference-sdk`](https://github.com/s-ference/sference) — a future
> release will expose them as a separate mode.

---

## What's here

This repo is a **standalone, public** npm package — not part of the platform
monorepo. It was extracted from `sference-platform` and lives on GitHub at
[s-ference/vercel-provider](https://github.com/s-ference/vercel-provider).

### Source layout (`src/`)
| File | Purpose |
|------|---------|
| `index.ts` | Public exports barrel |
| `sference-provider.ts` | `createSference()` factory + default `sference` export (implements `ProviderV4`) |
| `sference-chat-language-model.ts` | The `LanguageModelV4` impl — `doGenerate` + `doStream` |
| `convert-to-sference-chat-messages.ts` | AI SDK v4 prompt → sference chat `messages` |
| `sference-prepare-tools.ts` | Tool + toolChoice conversion; `providerOptions.sference` zod schema |
| `sference-chat-schemas.ts` | zod schemas for the chat completion/chunk wire format + request types |
| `convert-sference-usage.ts` | OpenAI/sference usage → `LanguageModelV4Usage` |
| `map-sference-finish-reason.ts` | OpenAI `finish_reason` → V4 unified finish reason |
| `sference-error.ts` | `createJsonErrorResponseHandler` for sference error bodies |
| `get-response-metadata.ts` | `id`/`model`/`created` → V4 response metadata |
| `version.ts` | Build-time package version |
| `sference-provider-options.ts` | `SferenceProviderSettings` (baseURL/apiKey/headers/fetch/generateId) |

### Tests (`tests/`)
- `convert-messages.test.ts` — prompt → chat message mapping
- `provider.test.ts` — end-to-end via the public `ai` SDK surface
  (`generateText`/`streamText`/`generateObject`), mocked fetch: text, reasoning,
  tool calls, structured output, provider options, reasoning-level mapping,
  4xx errors, SSE streaming, `stream-start`/`response-metadata` ordering.

### Tooling
- **Build:** `tsup` (ESM + `.d.ts`)
- **Test:** `vitest`
- **Typecheck:** `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)
- **Package manager:** `pnpm` (uses `pnpm-workspace.yaml` `allowBuilds: { esbuild: true }`)

```bash
pnpm install
pnpm build       # tsup
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit
```

---

## Spec & wire format

The provider targets **Language Model Spec v4**
(`@ai-sdk/provider@^4`, `@ai-sdk/provider-utils@^5`, `ai@^7`; peer-deps also allow
`ai@^5`/`^6` and `zod@^3`/`^4`). Built and tested against `ai@7.0.31`.

The sference wire format is **standard OpenAI Chat Completions** (derived from the
platform server code in `sference-platform`: `apps/api/sference_api/inference/adapters/openai_chat.py`
and `packages/sference_messaging/sference_messaging/streaming/chat_sse.py`):

- **Non-streaming:** `POST /v1/chat/completions` → `chat.completion` with
  `choices[].message.{content, reasoning_content, tool_calls}`, `usage`, `service_tier`.
- **Streaming:** same endpoint with `stream: true` + `stream_options.include_usage: true`
  → SSE `data: {chat.completion.chunk}` frames, deltas carry `content` /
  `reasoning_content` / `tool_calls` (correlated by `index`), a terminal
  `choices: []` usage frame, then `data: [DONE]`.
- **Auth:** `Authorization: Bearer sk_...`, env var `SFERENCE_API_KEY`.
- **sference-specific fields** (passed through, not part of OpenAI spec):
  `service_tier` (`auto`/`default`/`flex`/`scale`/`priority`; only `flex` changes
  behavior), `prompt_cache_key`, `enable_thinking`.

### Features supported
- ✅ `generateText` / `streamText` / `generateObject` / `streamObject`
- ✅ Tool calling (function tools, multi-turn tool results, SSE arg-delta reconstruction)
- ✅ Structured output (`response_format` json_schema / json_object)
- ✅ Reasoning (`reasoning_content` → V4 `reasoning` parts); SDK `reasoning` level → `enable_thinking`
- ✅ Multimodal image input (`image_url`, URL + base64)
- ✅ Provider options: `serviceTier`, `promptCacheKey`, `enableThinking`
- ✅ Workflow DevKit serialization (`WORKFLOW_SERIALIZE`/`WORKFLOW_DESERIALIZE`)
- ✅ `stream-start` / `response-metadata` / `includeRawChunks`
- ⚠️ `topK`, `presencePenalty`, `frequencyPenalty` → ignored with a warning
- ⚠️ Provider-defined tools → dropped with a warning
- ❌ Async / batch / streams (planned separate mode)

---

## Next steps

### 1. Publish to npm (the immediate blocker)
The package is **not yet published**. To ship `0.1.0`:

1. **Claim the `@sference` org** on npm: https://www.npmjs.com/org/create
   (creates the `@sference/*` scope). If you'd rather avoid an org, rename the
   package in `package.json` to unscoped `sference-vercel-provider` and drop
   `publishConfig.access`.
2. **Log in locally:**
   ```bash
   npm login
   ```
3. **Verify what gets published** (confirm `node_modules`/`tests`/configs are excluded):
   ```bash
   pnpm build && npm pack --dry-run
   ```
4. **Publish:**
   ```bash
   npm publish
   ```
   `publishConfig: { access: "public" }` is already set, so the scoped package
   publishes publicly on first publish.

### 2. Add a release workflow (recommended)
Add `.github/workflows/release.yml` that, on a GitHub Release / version tag:
builds, runs tests, then publishes to npm using an `NPM_TOKEN` secret. This
avoids manual `npm publish` and makes releases reproducible.

### 3. Wire into the AI SDK community-providers list
Once published, submit a PR to `vercel/ai` adding the provider to the
[Community Providers](https://ai-sdk.dev/providers/community-providers) docs,
using the [OpenRouter provider docs](https://github.com/vercel/ai/blob/main/content/providers/05-community-providers/32-openrouter.mdx)
as a template.

### 4. Live integration test
Add a smoke test against `https://api.sference.com` (gated behind
`SFERENCE_API_KEY` in CI, skipped locally without it) to catch wire-format
drift before users do.

### 5. Future: async / batch / streams mode
Expose the background `/v1/responses` surface (`15m`/`1h`/`24h` completion
windows, streams, batches) as a separate mode alongside realtime. The Python
[`sference-sdk`](https://github.com/s-ference/sference) already covers these
via submit→poll→fetch; the provider would emulate `doGenerate`/`doStream` over
that lifecycle. Decide the API shape (separate model factory? `providerOptions`
flag?) before implementing.

---

## Reference implementation

This provider follows the idioms of the canonical
[Mistral provider](https://github.com/vercel/ai/tree/main/packages/mistral) in
`vercel/ai`: `createEventSourceResponseHandler` + zod schemas for streaming,
`createJsonResponseHandler` for generate, `createJsonErrorResponseHandler` for
errors, `parseProviderOptions`, `withUserAgentSuffix`, `WORKFLOW_SERIALIZE`,
`getResponseMetadata`, and small single-purpose files (`convert-*-usage`,
`map-*-finish-reason`, `*-error`, `*-prepare-tools`).
