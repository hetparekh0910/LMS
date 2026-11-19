import type { ConnectionOptions } from "bullmq";

// Parses a redis:// or rediss:// URL into BullMQ connection options
export function redisConnection(urlStr: string): ConnectionOptions {
  const u = new URL(urlStr);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}