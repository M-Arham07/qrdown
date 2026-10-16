import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mockStorage } from "./mockStorage";
import { APP_CONFIG } from "./constants";

// Generic S3-compatible settings support Backblaze B2. The R2 variables remain
// as a compatibility fallback for deployments that have not switched yet.
const bucket = process.env.OBJECT_STORAGE_BUCKET || process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT || process.env.R2_ENDPOINT ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined);
const region = process.env.OBJECT_STORAGE_REGION ||
  (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT ? "auto" : undefined);
const isObjectStorageConfigured = Boolean(bucket && accessKeyId && secretAccessKey && endpoint && region);

const s3Client = isObjectStorageConfigured
  ? new S3Client({
      region: region!,
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    })
  : null;

export const objectStorageService = {
  isConfigured() {
    return isObjectStorageConfigured;
  },

  async createUploadUrl(key: string, contentType: string = "application/octet-stream") {
    if (!s3Client || !bucket) {
      return `/api/uploads/mock-upload?key=${encodeURIComponent(key)}`;
    }
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    return getSignedUrl(s3Client, command, { expiresIn: APP_CONFIG.presignedUrlTtlSeconds });
  },

  async createDownloadUrl(key: string) {
    if (!s3Client || !bucket) {
      return `/api/uploads/mock-upload?key=${encodeURIComponent(key)}`;
    }
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 300 });
  },

  async putObject(key: string, body: Uint8Array | Buffer, contentType: string = "application/octet-stream") {
    if (!s3Client || !bucket) {
      const arrayBuf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      mockStorage.set(key, { buffer: arrayBuf as ArrayBuffer, contentType });
      return;
    }
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  },

  async deleteObject(key: string) {
    if (!s3Client || !bucket) {
      mockStorage.delete(key);
      return;
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};
