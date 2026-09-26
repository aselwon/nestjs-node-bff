import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import { PrismaService } from "../common/prisma.service";
import { redisOptions } from "../common/config";

type ConfirmationJob = { orderId: string };

@Injectable()
export class ConfirmationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfirmationService.name);
  private queue?: Queue<ConfirmationJob>;
  private worker?: Worker<ConfirmationJob>;
  private timer?: NodeJS.Timeout;
  private publishing?: Promise<void>;

  constructor(private readonly db: PrismaService) {}

  onModuleInit() {
    const connection = redisOptions();
    this.queue = new Queue<ConfirmationJob>("confirmations", {
      connection: {
        ...connection,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        commandTimeout: 2000,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    this.worker = new Worker<ConfirmationJob>(
      "confirmations",
      (job) => this.sendStub(job),
      {
        connection: { ...connection, maxRetriesPerRequest: null },
        concurrency: 2,
      },
    );
    this.queue.on("error", () =>
      this.logger.warn(
        "Confirmation queue unavailable; orders remain in outbox",
      ),
    );
    this.worker.on("error", () =>
      this.logger.warn("Confirmation worker waiting for Redis"),
    );
    this.worker.on("failed", (job) =>
      this.logger.warn(`Confirmation job failed: ${job?.id ?? "unknown"}`),
    );
    this.timer = setInterval(() => {
      void this.publishPending();
    }, 1000);
    this.timer.unref();
  }

  publishPending(): Promise<void> {
    if (this.publishing) return this.publishing;
    this.publishing = this.dispatch()
      .catch(() => {
        this.logger.warn("Outbox dispatch postponed; retry on next tick");
      })
      .finally(() => {
        this.publishing = undefined;
      });
    return this.publishing;
  }

  private async dispatch() {
    if (!this.queue) return;
    const rows = await this.db.confirmationOutbox.findMany({
      where: { queuedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const row of rows) {
      await this.queue.add(
        "send-confirmation",
        { orderId: row.orderId },
        { jobId: `order-${row.orderId}` },
      );
      await this.db.confirmationOutbox.update({
        where: { orderId: row.orderId },
        data: { queuedAt: new Date() },
      });
    }
  }

  private async sendStub(job: Job<ConfirmationJob>) {
    // No provider and no real email. This durable marker makes the stub idempotent.
    const result = await this.db.order.updateMany({
      where: { id: job.data.orderId, confirmationSentAt: null },
      data: { confirmationSentAt: new Date() },
    });
    if (result.count)
      this.logger.log(
        `Email stub: confirmation recorded for order ${job.data.orderId}`,
      );
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.publishing;
    await this.worker?.close();
    await this.queue?.close();
  }
}
