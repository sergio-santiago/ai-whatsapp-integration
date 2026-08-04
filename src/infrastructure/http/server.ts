import express, { type Express, type Request, type Response } from 'express'
import type { Channel } from '../../domain/ports.ts'
import type { IncomingMessage } from '../../domain/types.ts'
import { type Logger, redact } from '../logger.ts'

/**
 * The HTTP edge.
 *
 * The order inside the POST handler is the whole point of this file:
 *
 *   authenticate the raw bytes -> parse -> answer 200 -> hand off the work
 *
 * The version this replaces answered 200 only after calling the model and
 * sending the reply, so a slow model looked to Meta like a failed delivery and
 * earned a retry, which produced a second answer to the same message. The 200
 * now goes out in milliseconds and the work happens behind it.
 *
 * Bodies are read as raw bytes rather than parsed JSON because an HMAC covers
 * the exact bytes received, and because nothing unauthenticated should reach a
 * parser.
 */

export type Enqueue = (channel: Channel, message: IncomingMessage) => boolean

export type CreateAppOptions = {
  readonly channels: readonly Channel[]
  /** Returns false when the queue refuses the work. */
  readonly enqueue: Enqueue
  readonly logger: Logger
  /** Rejected beyond this size, before any signature work. */
  readonly maxBodyBytes: number
  /** Flips to false on SIGTERM so a load balancer stops sending traffic. */
  readonly isReady: () => boolean
}

export function createApp(options: CreateAppOptions): Express {
  const { channels, enqueue, logger, maxBodyBytes, isReady } = options

  const app = express()
  app.disable('x-powered-by')

  app.get('/healthz', (_request: Request, response: Response) => {
    if (!isReady()) {
      response.status(503).json({ status: 'shutting_down' })
      return
    }
    response.status(200).json({ status: 'ok' })
  })

  for (const channel of channels) {
    const path = `/webhooks/${channel.name}`
    const log = logger.child({ channel: channel.name })

    if (channel.handshake !== undefined) {
      const handshake = channel.handshake.bind(channel)

      app.get(path, (request: Request, response: Response) => {
        const result = handshake(request.query as Record<string, string | undefined>)
        if (result.status !== 200) {
          log.warn('webhook handshake rejected')
        } else {
          log.info('webhook handshake accepted')
        }
        response.status(result.status).type('text/plain').send(result.body)
      })
    }

    app.post(
      path,
      // '*/*' rather than 'application/json': a request with the wrong
      // content-type must still produce a Buffer, so it fails the signature
      // check rather than silently arriving as an empty object.
      express.raw({ type: '*/*', limit: maxBodyBytes }),
      (request: Request, response: Response) => {
        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0)

        if (!channel.authenticate({ rawBody, headers: request.headers as Record<string, string | undefined> })) {
          log.warn('rejected unauthenticated webhook')
          response.sendStatus(403)
          return
        }

        let payload: unknown
        try {
          payload = JSON.parse(rawBody.toString('utf8'))
        } catch {
          log.warn('rejected malformed webhook body')
          response.sendStatus(400)
          return
        }

        const messages = channel.parse(payload)

        // An authenticated delivery that carries nothing to answer is normal:
        // read receipts and delivery statuses arrive on the same webhook.
        if (messages.length === 0) {
          response.sendStatus(200)
          return
        }

        let accepted = 0
        for (const message of messages) {
          if (enqueue(channel, message)) {
            accepted += 1
            log.debug('message accepted', {
              messageId: message.id,
              conversation: redact(message.conversationId),
              kind: message.kind,
            })
          }
        }

        if (accepted === 0) {
          // Nothing got through, so let the platform retry the whole delivery.
          log.error('queue full, rejecting delivery', { messages: messages.length })
          response.sendStatus(503)
          return
        }

        if (accepted < messages.length) {
          // A 503 here would make the platform redeliver the ones already
          // accepted, so the delivery is acknowledged and the loss is recorded.
          log.error('queue full, dropped part of a delivery', {
            accepted,
            dropped: messages.length - accepted,
          })
        }

        response.sendStatus(200)
      },
    )
  }

  return app
}
