import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { setInAppPushHandler } from '@jsk/domain-notifications';
import type { InAppPushHandler } from '@jsk/domain-notifications';

type Subscriber = { userId: string; res: Response };

/**
 * In-memory SSE hub for in-app notifications. One process, per-user fan-out.
 * The domain package pushes deliveries into this hub via `setInAppPushHandler`.
 */
@Injectable()
export class NotificationsGateway {
  private readonly logger = new Logger('NotificationsGateway');
  private readonly subscribers = new Set<Subscriber>();

  onModuleInit(): void {
    setInAppPushHandler(this.broadcast);
    this.logger.log('In-app notification SSE hub ready');
  }

  /** The push handler registered with the domain package. */
  readonly broadcast: InAppPushHandler = (delivery) => {
    for (const sub of this.subscribers) {
      if (sub.userId === delivery.recipient_user_id) {
        try {
          sub.res.write(`event: notification\ndata: ${JSON.stringify(delivery)}\n\n`);
        } catch {
          this.unsubscribe(sub);
        }
      }
    }
  };

  subscribe(userId: string, res: Response): () => void {
    const sub: Subscriber = { userId, res };
    this.subscribers.add(sub);
    return () => this.unsubscribe(sub);
  }

  unsubscribe(sub: Subscriber): void {
    if (this.subscribers.delete(sub)) {
      try {
        sub.res.end();
      } catch {
        /* already closed */
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}