import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APP_CONFIG } from "./constants";

const isR2Configured = Boolean(
  process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
);

const endpoint =
  process.env.R2_ENDPOINT ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined);

export const s3Client = isR2Configured
  ? new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export const r2Service = {
  isConfigured() {
    return isR2Configured;
  },

  async createUploadUrl(key: string, contentType: string = "application/octet-stream") {
    if (!s3Client || !process.env.R2_BUCKET_NAME) {
      // Local dev simulated presigned URL endpoint
      return `/api/uploads/mock-upload?key=${encodeURIComponent(key)}`;
    }
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(s3Client, command, {
      expiresIn: APP_CONFIG.presignedUrlTtlSeconds,
    });
  },

  async createDownloadUrl(key: string) {
    if (!s3Client || !process.env.R2_BUCKET_NAME) {
      return `/api/uploads/mock-download?key=${encodeURIComponent(key)}`;
    }
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes
  },

  async deleteObject(key: string) {
    if (!s3Client || !process.env.R2_BUCKET_NAME) return;
    try {
      const command = new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      });
      await s3Client.send(command);
    } catch {
      // Silently catch deletion errors on expired items
    }
  },
};
