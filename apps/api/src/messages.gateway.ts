import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { setMessagesPushHandler, setNotificationRefreshHook } from '@jsk/domain-messages';
import type { MessagesPushEvent, NotificationRefreshHook } from '@jsk/domain-messages';

type Subscriber = { userId: string; res: Response };

/**
 * In-memory SSE hub for messaging. One process, per-user fan-out.
 * The domain layer decides the audience (conversation members only) and pushes
 * events here; this gateway writes them to that user's open stream(s).
 */
@Injectable()
export class MessagesGateway {
  private readonly logger = new Logger('MessagesGateway');
  private readonly subscribers = new Set<Subscriber>();

  onModuleInit(): void {
    setMessagesPushHandler(this.broadcast);
    setNotificationRefreshHook(this.notifyUnreadChanged);
    this.logger.log('Messaging SSE hub ready');
  }

  /** The push handler registered with @jsk/domain-messages. */
  readonly broadcast: (evt: MessagesPushEvent) => void = (evt) => {
    const data = JSON.stringify(evt.payload);
    for (const sub of this.subscribers) {
      if (!evt.audience.includes(sub.userId)) continue;
      try {
        sub.res.write(`event: ${evt.event}\ndata: ${data}\n\n`);
      } catch {
        this.unsubscribe(sub);
      }
    }
  };

  /** Fired when a chat notification was created/refreshed for a recipient. */
  readonly notifyUnreadChanged: NotificationRefreshHook = (userId) => {
    for (const sub of this.subscribers) {
      if (sub.userId !== userId) continue;
      try {
        sub.res.write(`event: unread\ndata: {"conversation_id":null}\n\n`);
      } catch {
        this.unsubscribe(sub);
      }
    }
  };

  subscribe(userId: string, res: Response): () => void {
    const sub: Subscriber = { userId, res };
    this.subscribers.add(sub);
    return () => this.unsubscribe(sub);
  }

  unsubscribe(sub: Subscriber): void {
    this.subscribers.delete(sub);
  }
}
