import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

const s3 = new S3Client({
  region: config.AWS_REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".jpg": "image/jpeg",
};

export async function downloadTo(key: string, dest: string) {
  const out = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  await pipeline(out.Body as Readable, createWriteStream(dest));
}

export async function uploadFile(key: string, file: string) {
  const ext = path.extname(file).toLowerCase();
  const { size } = await fs.stat(file);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: TYPES[ext] ?? "application/octet-stream",
      CacheControl: ext === ".ts" ? "public, max-age=31536000" : "public, max-age=300",
    })
  );
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  );
  return files.flat();
}

// Uploads every file under localDir to s3://bucket/prefix/... with limited concurrency
export async function uploadDir(localDir: string, prefix: string) {
  const files = await walk(localDir);
  let next = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      const rel = path.relative(localDir, file).split(path.sep).join("/");
      await uploadFile(`${prefix}/${rel}`, file);
    }
  });
  await Promise.all(workers);
}