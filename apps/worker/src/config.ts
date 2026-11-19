import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const config = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  AWS_REGION: process.env.AWS_REGION ?? "ap-south-1",
  S3_BUCKET: process.env.S3_BUCKET as string,
};

if (!config.S3_BUCKET) throw new Error("S3_BUCKET is not set in .env");