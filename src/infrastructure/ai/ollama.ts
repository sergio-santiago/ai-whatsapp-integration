import type { AiProvider } from '../../domain/ports.ts'
import { fetchJson } from '../fetch-json.ts'
import { asRecord, asString } from '../json.ts'

/**
 * Ollama, running a model on the same machine.
 *
 * This adapter is what makes the repository runnable by anyone: no account, no
 * API key, no billing. Point `AI_PROVIDER` at it, pair it with the Telegram
 * channel, and the whole flow works end to end on a laptop.
 *
 * It also keeps `AiProvider` honest. A port with a single implementation ends
 * up being that implementation's interface under another name; a local model
 * with no auth header and a different response shape does not let that happen.
 */

export type OllamaProviderOptions = {
  readonly model: string
  readonly systemPrompt: string
  readonly timeoutMs: number
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

export function createOllamaProvider(options: OllamaProviderOptions): AiProvider {
  const baseUrl = options.baseUrl ?? 'http://localhost:11434'

  return {
    name: 'ollama',

    async reply(prompt: string): Promise<string> {
      const payload = await fetchJson({
        url: `${baseUrl}/api/chat`,
        method: 'POST',
        body: {
          model: options.model,
          messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: prompt },
          ],
          // The port returns a whole answer, so there is nothing to stream to.
          stream: false,
        },
        timeoutMs: options.timeoutMs,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      })

      const content = asString(asRecord(asRecord(payload)?.['message'])?.['content'])

      if (content === null) {
        throw new Error('Ollama returned no message content')
      }

      return content
    },
  }
}
