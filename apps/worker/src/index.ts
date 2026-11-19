import { Worker } from "bullmq";
import "./config";
import { prisma, VideoStatus } from "@lms/db";
import { config } from "./config";
import { redisConnection } from "./redis";
import { transcode } from "./transcode";

const worker = new Worker(
  "transcode",
  async (job) => {
    await transcode(job.data.assetId, (p) => void job.updateProgress(p));
  },
  {
    connection: redisConnection(config.REDIS_URL),
    concurrency: 1, // FFmpeg is CPU heavy
    drainDelay: 30, // fewer idle polls (saves Upstash commands)
  }
);

worker.on("ready", () => console.log("Worker ready, waiting for transcode jobs..."));
worker.on("error", (err) => console.error("[worker error]", err.message));

worker.on("failed", async (job, err) => {
  console.error(`[transcode] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await prisma.videoAsset
      .update({
        where: { id: job.data.assetId },
        data: { status: VideoStatus.FAILED, errorMessage: err.message.slice(0, 500) },
      })
      .catch(() => undefined);
  }
});

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);