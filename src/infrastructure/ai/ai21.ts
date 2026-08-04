import type { AiProvider } from '../../domain/ports.ts'
import { fetchJson } from '../fetch-json.ts'
import { asArray, asRecord, asString } from '../json.ts'

/**
 * AI21 Studio, Jamba chat completions.
 *
 * No retry: the timeout is the whole budget. Somebody is waiting on the other
 * end of a chat, and a second attempt spends their patience to maybe improve
 * an answer the fallback already covers. Delivery retries, the model does not.
 */

export type Ai21ProviderOptions = {
  readonly apiKey: string
  readonly model: string
  readonly systemPrompt: string
  readonly maxTokens: number
  readonly temperature: number
  readonly timeoutMs: number
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

export function createAi21Provider(options: Ai21ProviderOptions): AiProvider {
  const baseUrl = options.baseUrl ?? 'https://api.ai21.com'

  return {
    name: 'ai21',

    async reply(prompt: string): Promise<string> {
      const payload = await fetchJson({
        url: `${baseUrl}/studio/v1/chat/completions`,
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: {
          model: options.model,
          messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        },
        timeoutMs: options.timeoutMs,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      })

      const choice = asArray(asRecord(payload)?.['choices'])[0]
      const content = asString(asRecord(asRecord(choice)?.['message'])?.['content'])

      if (content === null) {
        throw new Error('AI21 returned no message content')
      }

      return content
    },
  }
}
