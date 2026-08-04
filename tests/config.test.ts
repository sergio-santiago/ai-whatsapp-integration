import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigError, type Env, loadConfig } from '../src/infrastructure/config.ts'

const WHATSAPP_ENV: Env = {
  CHANNELS: 'whatsapp',
  WHATSAPP_APP_SECRET: 'secret',
  WHATSAPP_VERIFY_TOKEN: 'verify',
  WHATSAPP_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: '1',
  AI_PROVIDER: 'ai21',
  AI21_API_KEY: 'key',
}

function problemsOf(env: Env): readonly string[] {
  try {
    loadConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) return error.problems
    throw error
  }
  return []
}

describe('config: happy paths', () => {
  it('loads a whatsapp and ai21 setup', () => {
    const config = loadConfig(WHATSAPP_ENV)

    assert.equal(config.channels.whatsapp?.appSecret, 'secret')
    assert.equal(config.channels.telegram, null)
    assert.equal(config.ai.provider, 'ai21')
    assert.equal(config.ai.ai21?.apiKey, 'key')
    assert.equal(config.ai.ollama, null)
  })

  it('loads both channels at once', () => {
    const config = loadConfig({
      ...WHATSAPP_ENV,
      CHANNELS: 'whatsapp, telegram',
      TELEGRAM_BOT_TOKEN: 'bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
    })

    assert.ok(config.channels.whatsapp !== null)
    assert.equal(config.channels.telegram?.botToken, 'bot')
  })

  it('runs on telegram and ollama with no paid account anywhere', () => {
    // This combination is what lets someone clone the repo and see it work.
    const config = loadConfig({
      CHANNELS: 'telegram',
      TELEGRAM_BOT_TOKEN: 'bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      AI_PROVIDER: 'ollama',
    })

    assert.equal(config.ai.provider, 'ollama')
    assert.equal(config.ai.ollama?.model, 'llama3.2')
    assert.equal(config.ai.ai21, null)
  })

  it('defaults the graph version to a currently supported one', () => {
    // v18.0 was hardcoded and has since expired, which is how the service
    // silently stopped working.
    assert.equal(loadConfig(WHATSAPP_ENV).channels.whatsapp?.graphVersion, 'v26.0')
  })

  it('applies documented defaults', () => {
    const config = loadConfig(WHATSAPP_ENV)

    assert.equal(config.port, 3000)
    assert.equal(config.logLevel, 'info')
    assert.equal(config.queue.concurrency, 4)
    assert.equal(config.send.retries, 2)
    assert.equal(config.shutdown.graceMs, 0)
    assert.ok(config.ai.systemPrompt.length > 0, 'there is always a system prompt')
  })

  it('takes the system prompt from the environment', () => {
    // The prompt used to be a Spanish string hardcoded in the AI21 adapter.
    const config = loadConfig({ ...WHATSAPP_ENV, AI_SYSTEM_PROMPT: 'You are a pirate.' })

    assert.equal(config.ai.systemPrompt, 'You are a pirate.')
  })

  it('trims surrounding whitespace from values', () => {
    const config = loadConfig({ ...WHATSAPP_ENV, WHATSAPP_TOKEN: '  token  ' })

    assert.equal(config.channels.whatsapp?.accessToken, 'token')
  })
})

describe('config: failing fast', () => {
  it('refuses to start when a required secret is missing', () => {
    const { WHATSAPP_APP_SECRET: _omitted, ...withoutSecret } = WHATSAPP_ENV

    assert.throws(() => loadConfig(withoutSecret), ConfigError)
  })

  it('treats an empty string as missing', () => {
    assert.deepEqual(problemsOf({ ...WHATSAPP_ENV, WHATSAPP_TOKEN: '   ' }), [
      'WHATSAPP_TOKEN is required',
    ])
  })

  it('reports every problem at once instead of one per restart', () => {
    const problems = problemsOf({ CHANNELS: 'whatsapp', AI_PROVIDER: 'ai21' })

    assert.equal(problems.length, 5, problems.join(', '))
    assert.ok(problems.some((problem) => problem.includes('WHATSAPP_APP_SECRET')))
    assert.ok(problems.some((problem) => problem.includes('AI21_API_KEY')))
  })

  it('rejects an unknown channel', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, CHANNELS: 'whatsapp,signal' })

    assert.ok(problems.some((problem) => problem.includes('signal')))
  })

  it('rejects an empty channel list', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, CHANNELS: ' , ' })

    assert.ok(problems.some((problem) => problem.includes('at least one channel')))
  })

  it('rejects an unknown ai provider', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, AI_PROVIDER: 'gpt' })

    assert.ok(problems.some((problem) => problem.includes('AI_PROVIDER')))
  })

  it('requires the credentials of the channels actually enabled', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, CHANNELS: 'telegram' })

    assert.deepEqual([...problems].sort(), [
      'TELEGRAM_BOT_TOKEN is required',
      'TELEGRAM_WEBHOOK_SECRET is required',
    ])
  })

  it('rejects a non-numeric port', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, PORT: 'eighty' })

    assert.ok(problems.some((problem) => problem.includes('PORT must be an integer')))
  })

  it('rejects numbers below their minimum', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, QUEUE_CONCURRENCY: '0', DEDUP_MAX_ENTRIES: '0' })

    assert.equal(problems.length, 2)
  })

  it('rejects a temperature outside the valid range', () => {
    assert.ok(problemsOf({ ...WHATSAPP_ENV, AI21_TEMPERATURE: '5' }).length > 0)
    assert.equal(problemsOf({ ...WHATSAPP_ENV, AI21_TEMPERATURE: '0.2' }).length, 0)
  })

  it('rejects an unknown log level', () => {
    const problems = problemsOf({ ...WHATSAPP_ENV, LOG_LEVEL: 'verbose' })

    assert.ok(problems.some((problem) => problem.includes('LOG_LEVEL')))
  })

  it('allows a zero grace period but not a zero drain deadline', () => {
    assert.equal(problemsOf({ ...WHATSAPP_ENV, SHUTDOWN_GRACE_MS: '0' }).length, 0)
    assert.equal(problemsOf({ ...WHATSAPP_ENV, SHUTDOWN_DRAIN_MS: '0' }).length, 1)
  })

  it('lists every problem in the error message', () => {
    try {
      loadConfig({ CHANNELS: 'telegram', AI_PROVIDER: 'ollama' })
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /TELEGRAM_BOT_TOKEN/)
      assert.match(error.message, /TELEGRAM_WEBHOOK_SECRET/)
    }
  })
})
