import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';
import { z } from 'zod';

// sference returns OpenAI-shaped errors: { error: { message, type, code, param } }
// and (for some validation paths) { detail: string }.
const sferenceErrorDataSchema = z.object({
  error: z
    .object({
      message: z.string(),
      type: z.string().nullish(),
      code: z.string().nullish(),
      param: z.string().nullish(),
    })
    .nullish(),
  detail: z.string().nullish(),
  message: z.string().nullish(),
});

export type SferenceErrorData = z.infer<typeof sferenceErrorDataSchema>;

export const sferenceFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: sferenceErrorDataSchema,
  errorToMessage: (data) =>
    data.error?.message ?? data.detail ?? data.message ?? 'Unknown sference error',
  isRetryable: (response) => response.status >= 500 && response.status < 600,
});
