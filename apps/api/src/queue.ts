import { Queue } from "bullmq";
import { config } from "./config";
import { redisConnection } from "./lib/redis";

export const TRANSCODE_QUEUE = "transcode";

let queue: Queue | null = null;

export function transcodeQueue() {
  if (!queue) {
    queue = new Queue(TRANSCODE_QUEUE, {
      connection: redisConnection(config.REDIS_URL),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    });
  }
  return queue;
}