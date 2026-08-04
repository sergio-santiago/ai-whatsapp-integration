import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiProvider } from '../src/domain/ports.ts'
import { createAi21Provider } from '../src/infrastructure/ai/ai21.ts'
import { createOllamaProvider } from '../src/infrastructure/ai/ollama.ts'
import { TimeoutError } from '../src/infrastructure/fetch-json.ts'
import { type StubResponse, stubFetch } from './support/doubles.ts'

const SYSTEM_PROMPT = 'You are a helpful assistant.'

type Subject = {
  readonly label: string
  readonly build: (fetchImpl: typeof fetch) => AiProvider
  /** A response body in that provider's own shape, carrying `text`. */
  readonly answerWith: (text: string) => StubResponse
  /** A well-formed 200 that carries no usable answer. */
  readonly emptyResponse: StubResponse
}

const SUBJECTS: readonly Subject[] = [
  {
    label: 'ai21',
    build: (fetchImpl) =>
      createAi21Provider({
        apiKey: 'key',
        model: 'jamba-large-1.7',
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 512,
        temperature: 0.7,
        timeoutMs: 1000,
        fetchImpl,
      }),
    answerWith: (text) => ({ body: { choices: [{ message: { role: 'assistant', content: text } }] } }),
    emptyResponse: { body: { choices: [] } },
  },
  {
    label: 'ollama',
    build: (fetchImpl) =>
      createOllamaProvider({
        model: 'llama3.2',
        systemPrompt: SYSTEM_PROMPT,
        timeoutMs: 1000,
        fetchImpl,
      }),
    answerWith: (text) => ({ body: { message: { role: 'assistant', content: text }, done: true } }),
    emptyResponse: { body: { done: true } },
  },
]

for (const subject of SUBJECTS) {
  describe(`ai provider contract: ${subject.label}`, () => {
    it('names itself', () => {
      assert.equal(subject.build(stubFetch([]).fetchImpl).name, subject.label)
    })

    it('returns the answer', async () => {
      const { fetchImpl } = stubFetch([subject.answerWith('the answer')])

      assert.equal(await subject.build(fetchImpl).reply('a question'), 'the answer')
    })

    it('sends the system prompt and the user text as two messages', async () => {
      const { fetchImpl, calls } = stubFetch([subject.answerWith('ok')])

      await subject.build(fetchImpl).reply('a question')

      const body = JSON.parse(String(calls[0]?.init?.body)) as {
        messages: { role: string; content: string }[]
      }
      assert.deepEqual(body.messages, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'a question' },
      ])
    })

    it('throws when the response carries no content', async () => {
      const { fetchImpl } = stubFetch([subject.emptyResponse])

      await assert.rejects(() => subject.build(fetchImpl).reply('a question'), /no message content/)
    })

    it('throws on a provider error, so the use case can fall back', async () => {
      const { fetchImpl } = stubFetch([{ status: 500 }])

      await assert.rejects(() => subject.build(fetchImpl).reply('a question'))
    })

    it('throws a TimeoutError when the provider hangs', async () => {
      const aborted = new Error('aborted')
      aborted.name = 'TimeoutError'
      const { fetchImpl } = stubFetch([{ throws: aborted }])

      await assert.rejects(() => subject.build(fetchImpl).reply('a question'), TimeoutError)
    })

    it('makes exactly one attempt, leaving retries to delivery', async () => {
      const { fetchImpl, calls } = stubFetch([{ status: 503 }, subject.answerWith('late')])

      await assert.rejects(() => subject.build(fetchImpl).reply('a question'))

      assert.equal(calls.length, 1, 'the user is waiting; the fallback is faster than a retry')
    })

    it('puts a deadline on the call', async () => {
      const { fetchImpl, calls } = stubFetch([subject.answerWith('ok')])

      await subject.build(fetchImpl).reply('a question')

      assert.ok(calls[0]?.init?.signal instanceof AbortSignal)
    })
  })
}

describe('ai21 specifics', () => {
  it('authenticates with a bearer token and sends the tuning parameters', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { choices: [{ message: { content: 'ok' } }] } }])

    await SUBJECTS[0]?.build(fetchImpl).reply('question')

    assert.equal(calls[0]?.url, 'https://api.ai21.com/studio/v1/chat/completions')
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], 'Bearer key')

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    assert.equal(body['model'], 'jamba-large-1.7')
    assert.equal(body['max_tokens'], 512)
    assert.equal(body['temperature'], 0.7)
  })
})

describe('ollama specifics', () => {
  it('calls the local server with streaming off and no credentials', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { message: { content: 'ok' } } }])

    await SUBJECTS[1]?.build(fetchImpl).reply('question')

    assert.equal(calls[0]?.url, 'http://localhost:11434/api/chat')
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['authorization'], undefined)
    assert.equal((JSON.parse(String(calls[0]?.init?.body)) as { stream: boolean }).stream, false)
  })
})
