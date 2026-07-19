import { describe, it, expect } from 'vitest';
import { convertToSferenceChatMessages } from '../src/convert-to-sference-chat-messages.js';

describe('convertToSferenceChatMessages', () => {
  it('maps a simple system+user prompt to chat messages', () => {
    const messages = convertToSferenceChatMessages([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);
    expect(messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('maps assistant tool calls and tool results', () => {
    const messages = convertToSferenceChatMessages([
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            input: { city: 'Ljubljana' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            output: { type: 'text', value: 'sunny' },
          },
        ],
      },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'weather?' },
      {
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
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'get_weather',
        content: 'sunny',
      },
    ]);
  });

  it('maps image_url file parts to multimodal content arrays', () => {
    const messages = convertToSferenceChatMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'url', url: 'https://example.com/cat.png' },
          },
        ],
      },
    ]);
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/cat.png' },
          },
        ],
      },
    ]);
  });

  it('coalesces multiple text parts into one string for text-only user messages', () => {
    const messages = convertToSferenceChatMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
    expect(messages).toEqual([{ role: 'user', content: 'ab' }]);
  });

  it('serializes JSON tool results', () => {
    const messages = convertToSferenceChatMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 't',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      },
    ]);
    expect(messages[0]?.content).toBe('{"ok":true}');
  });
});
