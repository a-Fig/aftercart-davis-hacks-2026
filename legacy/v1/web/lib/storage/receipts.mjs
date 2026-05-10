/**
 * GCS upload helper for raw receipt photos uploaded through /contribute.
 *
 * Bucket layout:
 *   gs://<RECEIPT_PHOTOS_BUCKET>/<sha256>.<ext>
 *
 * The SHA-256 doubles as the object key AND the dedup key in the
 * `receipts.image_hash` column — same image always lands at the same path,
 * so re-uploads are O(1) detect via either side.
 *
 * Auth: Application Default Credentials. On Cloud Run the runtime service
 * account inherits storage.objectAdmin on the bucket; locally, run
 * `gcloud auth application-default login`.
 *
 * We deliberately keep the bucket private (uniform bucket-level access).
 * Serving images back to the inspector requires a separate signed-URL
 * endpoint (deferred — see TODO at bottom of this file).
 */

import { Storage } from '@google-cloud/storage'

const DEFAULT_BUCKET = 'aftercart-receipt-photos'

let storageClient = null

function getStorage() {
  if (!storageClient) {
    // ADC. No credentials object — let the SDK find them.
    storageClient = new Storage()
  }
  return storageClient
}

function bucketName() {
  return process.env.RECEIPT_PHOTOS_BUCKET ?? DEFAULT_BUCKET
}

/**
 * Map a Content-Type to a file extension. Unknown types → 'bin' so we
 * don't accidentally write extensionless objects (which can confuse
 * tooling that infers MIME from the extension on download).
 *
 * @param {string} contentType
 * @returns {string}
 */
function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg'
  if (ct === 'image/png') return 'png'
  if (ct === 'image/webp') return 'webp'
  if (ct === 'image/heic' || ct === 'image/heif') return 'heic'
  return 'bin'
}

/**
 * Build the canonical object key for a given receipt image.
 *
 * @param {string} hash - SHA-256 hex of the image bytes
 * @param {string} ext  - extension WITHOUT the leading dot
 * @returns {string}
 */
export function receiptObjectKey(hash, ext) {
  const safeExt = String(ext || 'bin').replace(/^\./, '').toLowerCase()
  return `${hash}.${safeExt}`
}

/**
 * Upload a receipt image to GCS, deduping on the SHA-256 hash.
 *
 * If an object with the same key already exists in the bucket the upload is
 * skipped — return the existing URI instead. This keeps re-uploads of the
 * same photo cheap and avoids overwriting metadata on identical bytes.
 *
 * @param {Buffer} bytes
 * @param {string} contentType
 * @param {string} hash - SHA-256 hex of `bytes`. Caller computes this so the
 *                       same hash can be reused as the receipts.image_hash
 *                       dedup key without re-hashing.
 * @returns {Promise<{ gsUri: string, publicPath: string, key: string, deduped: boolean }>}
 */
export async function uploadReceiptImage(bytes, contentType, hash) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError('uploadReceiptImage: bytes must be a Buffer')
  }
  if (!hash || typeof hash !== 'string') {
    throw new TypeError('uploadReceiptImage: hash (sha256 hex) is required')
  }

  const ext = extFromContentType(contentType)
  const key = receiptObjectKey(hash, ext)
  const bucket = getStorage().bucket(bucketName())
  const file = bucket.file(key)

  // exists() returns [boolean]; faster than HEAD via the JSON API and
  // doesn't consume per-object download quota.
  const [exists] = await file.exists()
  if (!exists) {
    await file.save(bytes, {
      contentType: contentType || 'application/octet-stream',
      resumable: false, // small (<10 MB) — single-shot upload is faster
      metadata: {
        cacheControl: 'public, max-age=31536000',
        contentType: contentType || 'application/octet-stream',
      },
    })
  }

  return {
    gsUri: `gs://${bucketName()}/${key}`,
    // TODO: wire this to a /contribute/api/photo/<key> route that returns a
    // short-lived signed URL so the inspector can render the image inline.
    // For now the path is a stable placeholder consumers can ignore.
    publicPath: `/contribute/api/photo/${key}`,
    key,
    deduped: exists,
  }
}
