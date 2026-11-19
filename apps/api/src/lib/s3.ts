import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";

export const s3 = new S3Client({
  region: config.AWS_REGION,
  // Newer SDK versions add checksum params to presigned PUTs, which breaks browser uploads
  requestChecksumCalculation: "WHEN_REQUIRED",
});

export function presignUpload(key: string, contentType: string, expiresIn = 3600) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

export async function objectExists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}