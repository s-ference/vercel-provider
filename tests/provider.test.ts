import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateText, streamText, generateObject } from 'ai';
import { z } from 'zod';
import { createSference } from '../src/sference-provider.js';

/**
 * End-to-end-ish tests that mock fetch and drive the provider through the
 * public `ai` SDK surface (`generateText` / `streamText` / `generateObject`).
 *
 * These validate the full V4 contract: prompt mapping, request body shape,
 * response parsing, usage, finish reason, reasoning, tool calls, and SSE
 * streaming.
 */

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

function jsonCompletion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'Qwen/Qwen3.6-35B-A3B',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hi there!' },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    ...overrides,
  };
}

describe('SferenceProvider via AI SDK', () => {
  const fetchMock = vi.fn();
  const sference = createSference({ apiKey: 'sk_test', fetch: fetchMock as never });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  describe('generateText', () => {
    it('posts a chat completion and returns text + usage', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(jsonCompletion()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: 'Hello',
      });

      expect(result.text).toBe('Hi there!');
      expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
      expect(result.finishReason).toBe('stop');

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.sference.com/v1/chat/completions');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({
        model: 'Qwen/Qwen3.6-35B-A3B',
        stream: false,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect((init as RequestInit).headers).toMatchObject({
        authorization: 'Bearer sk_test',
        'content-type': 'application/json',
      });
    });

    it('maps reasoning_content to reasoning content', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            jsonCompletion({
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: '42',
                    reasoning_content: 'thinking hard',
                  },
                  finish_reason: 'stop',
                  logprobs: null,
                },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: '2+2?',
      });

      expect(result.reasoningText).toBe('thinking hard');
      expect(result.text).toBe('42');
    });

    it('passes providerOptions.sference through to the request body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(jsonCompletion()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: 'Hello',
        providerOptions: {
          sference: { serviceTier: 'flex', promptCacheKey: 'sess-1', enableThinking: false },
        },
      });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.service_tier).toBe('flex');
      expect(body.prompt_cache_key).toBe('sess-1');
      expect(body.enable_thinking).toBe(false);
    });

    it('maps the SDK reasoning level to enable_thinking (provider options win)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(jsonCompletion()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: 'think hard',
        reasoning: 'high',
      });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.enable_thinking).toBe(true);
    });

    it('maps reasoning: none to enable_thinking: false', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(jsonCompletion()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: 'hi',
        reasoning: 'none',
      });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.enable_thinking).toBe(false);
    });

    it('maps tool calls in the response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            jsonCompletion({
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'get_weather', arguments: '{"city":"Ljubljana"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                  logprobs: null,
                },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await generateText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        tools: {
          get_weather: {
            inputSchema: z.object({ city: z.string() }),
            execute: async ({ city }) => `weather in ${city}`,
          },
        },
        prompt: 'weather in Ljubljana?',
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: { city: 'Ljubljana' },
      });
      // The tool should have been executed by the SDK harness.
      expect(result.toolResults?.[0]?.output).toBe('weather in Ljubljana');
    });

    it('raises an APICallError on a 4xx', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'bad model' } }),
          { status: 400 },
        ),
      );

      await expect(
        generateText({ model: sference('nope'), prompt: 'hi' }),
      ).rejects.toThrowError(/bad model/);
    });
  });

  describe('generateObject', () => {
    it('sends a json_schema response_format and parses the object', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            jsonCompletion({
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '{"city":"Ljubljana"}' },
                  finish_reason: 'stop',
                  logprobs: null,
                },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await generateObject({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        schema: z.object({ city: z.string() }),
        prompt: 'Return a city',
      });

      expect(result.object).toEqual({ city: 'Ljubljana' });
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: expect.objectContaining({ schema: expect.any(Object) }),
      });
    });
  });

  describe('streamText', () => {
    it('parses SSE text deltas and emits a finish', async () => {
      const frames = [
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(sseBody(frames), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

      const result = streamText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: 'Hi',
      });

      const text = await result.text;
      expect(text).toBe('Hello world');
      expect(await result.finishReason).toBe('stop');
      expect(await result.usage).toMatchObject({ inputTokens: 2, outputTokens: 2, totalTokens: 4 });
    });

    it('streams reasoning_content as reasoning parts', async () => {
      const frames = [
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"reasoning_content":"hmm"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"42"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}]}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(sseBody(frames), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

      const result = streamText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        prompt: '2+2?',
      });

      // streamText exposes reasoning as an array of parts; join the text.
      const reasoningParts = await result.reasoning;
      expect(reasoningParts.map((p) => ('text' in p ? p.text : '')).join('')).toBe('hmm');
      expect(await result.text).toBe('42');
    });

    it('streams tool-call argument deltas and reconstructs the call', async () => {
      const frames = [
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Ljub\\"}"}}]},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls","logprobs":null}]}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(sseBody(frames), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

      const result = streamText({
        model: sference('Qwen/Qwen3.6-35B-A3B'),
        tools: {
          get_weather: {
            inputSchema: z.object({ city: z.string() }),
            execute: async ({ city }) => `weather: ${city}`,
          },
        },
        prompt: 'weather?',
      });

      const toolCalls = await result.toolCalls;
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: { city: 'Ljub' },
      });
    });

    it('emits stream-start, response-metadata, and finish in order', async () => {
      const frames = [
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null,"logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(sseBody(frames), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

      const model = sference('Qwen/Qwen3.6-35B-A3B');
      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        abortSignal: undefined,
      } as never);

      const types: string[] = [];
      for await (const part of stream) types.push(part.type);

      // stream-start must be first, finish last.
      expect(types[0]).toBe('stream-start');
      expect(types[types.length - 1]).toBe('finish');
      // response-metadata appears exactly once, after stream-start.
      expect(types.filter((t) => t === 'response-metadata')).toHaveLength(1);
      expect(types.indexOf('response-metadata')).toBeGreaterThan(0);
    });
  });
});
