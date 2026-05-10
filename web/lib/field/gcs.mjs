/**
 * GCS upload + download helpers for field-collection photos.
 *
 * Bucket layout:
 *   gs://<FIELD_GCS_BUCKET>/<store_id>/<yyyymmdd>/<sha256>.<ext>
 *
 * The store_id + date prefix is purely for human-browsability of the bucket;
 * dedup is enforced at the SQL layer via field_uploads.UNIQUE(photo_sha256, store_id).
 *
 * Auth: Application Default Credentials. On Cloud Run the runtime service
 * account inherits storage.objectAdmin on the bucket; locally, run
 * `gcloud auth application-default login`. Same pattern as
 * web/lib/storage/receipts.mjs.
 *
 * The bucket is private. The /api/field/photo/[upload_id]/image route streams
 * objects back through Next.js so we never expose signed URLs to the client.
 */

import { Storage } from '@google-cloud/storage'

const DEFAULT_BUCKET = 'aftercart-field-uploads'

let storageClient = null

function getStorage() {
  if (!storageClient) storageClient = new Storage()
  return storageClient
}

function bucketName() {
  return process.env.FIELD_GCS_BUCKET ?? DEFAULT_BUCKET
}

function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg'
  if (ct === 'image/png') return 'png'
  if (ct === 'image/webp') return 'webp'
  if (ct === 'image/heic' || ct === 'image/heif') return 'heic'
  if (ct === 'application/pdf') return 'pdf'
  return 'bin'
}

function dateStamp(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * Build the canonical object key for a field photo.
 *
 * @param {number|bigint|string} storeId
 * @param {string} hash - SHA-256 hex of the image bytes
 * @param {string} ext  - extension WITHOUT the leading dot
 * @returns {string}
 */
export function fieldPhotoObjectKey(storeId, hash, ext) {
  const safeExt = String(ext || 'bin').replace(/^\./, '').toLowerCase()
  return `${storeId}/${dateStamp()}/${hash}.${safeExt}`
}

/**
 * Upload a field photo to GCS, deduping on SHA-256 hash + store.
 *
 * @param {Buffer} bytes
 * @param {string} contentType
 * @param {string} hash - SHA-256 hex of bytes
 * @param {number|bigint|string} storeId
 * @returns {Promise<{ gsUri: string, key: string, deduped: boolean }>}
 */
export async function uploadFieldPhoto(bytes, contentType, hash, storeId) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError('uploadFieldPhoto: bytes must be a Buffer')
  }
  if (!hash || typeof hash !== 'string') {
    throw new TypeError('uploadFieldPhoto: hash (sha256 hex) is required')
  }
  if (storeId == null) {
    throw new TypeError('uploadFieldPhoto: storeId is required')
  }

  const ext = extFromContentType(contentType)
  const key = fieldPhotoObjectKey(storeId, hash, ext)
  const bucket = getStorage().bucket(bucketName())
  const file = bucket.file(key)

  const [exists] = await file.exists()
  if (!exists) {
    await file.save(bytes, {
      contentType: contentType || 'application/octet-stream',
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=31536000',
        contentType: contentType || 'application/octet-stream',
      },
    })
  }

  return {
    gsUri: `gs://${bucketName()}/${key}`,
    key,
    deduped: exists,
  }
}

/**
 * Stream a field photo back from GCS for the /api/field/photo/[id]/image
 * proxy route. Returns the raw stream, content type, and content length so
 * the route handler can pipe it back to the client without buffering.
 *
 * @param {string} gsUri - "gs://bucket/key" returned by uploadFieldPhoto
 * @returns {Promise<{ stream: NodeJS.ReadableStream, contentType: string, size: number|null }>}
 */
export async function downloadFieldPhotoStream(gsUri) {
  if (!gsUri || !gsUri.startsWith('gs://')) {
    throw new Error(`Invalid gsUri: ${gsUri}`)
  }
  const withoutScheme = gsUri.slice(5)
  const slash = withoutScheme.indexOf('/')
  if (slash < 0) throw new Error(`Malformed gsUri: ${gsUri}`)
  const bucketArg = withoutScheme.slice(0, slash)
  const keyArg = withoutScheme.slice(slash + 1)

  const file = getStorage().bucket(bucketArg).file(keyArg)
  const [metadata] = await file.getMetadata()
  return {
    stream: file.createReadStream(),
    contentType: metadata.contentType || 'application/octet-stream',
    size: metadata.size != null ? Number(metadata.size) : null,
  }
}
