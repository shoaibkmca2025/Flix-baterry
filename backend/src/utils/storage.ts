import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from './errors';

// Neon Object Storage (memory.md D-10, 2 Oct 2026). Declaring `buckets` in the root neon.ts
// makes Neon inject AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 /
// AWS_REGION into the deployed function, which the AWS SDK reads by itself. Locally they
// come from `neon env pull`. Neon needs path-style addressing.
export const EVIDENCE_BUCKET = 'evidence';

let client: S3Client | undefined;
function s3() {
  if (!process.env.AWS_ENDPOINT_URL_S3) {
    throw new AppError('storage_unavailable', 503, 'Photo storage is not set up on this server yet.');
  }
  client ??= new S3Client({ forcePathStyle: true });
  return client;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** A link that opens the photo for `seconds` (default 1 h) — the bucket itself stays private. */
export function signedUrl(key: string, seconds = 3600) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }), { expiresIn: seconds });
}
