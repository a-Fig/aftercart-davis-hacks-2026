/**
 * GET /api/field/photo/[upload_id]/image
 *
 * Same-origin proxy for the private GCS object backing a field_upload row.
 * Streams the image bytes through Next.js so the bucket can stay private and
 * we never hand a signed URL to the client.
 *
 * Heavy clients should treat this as cache-friendly — we set Cache-Control
 * matching the original GCS metadata (long-lived, immutable by sha256).
 */

import { NextRequest } from 'next/server'

import { query } from '@/lib/receipts/db.mjs'
import { downloadFieldPhotoStream } from '@/lib/field/gcs.mjs'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ upload_id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { upload_id } = await ctx.params
  const uploadId = Number(upload_id)
  if (!Number.isFinite(uploadId) || uploadId <= 0) {
    return new Response('Invalid upload id', { status: 400 })
  }

  const rows = (await query(
    `SELECT photo_url FROM field_uploads WHERE upload_id = $1`,
    [uploadId],
  )) as Array<{ photo_url: string }>
  if (rows.length === 0) {
    return new Response('Upload not found', { status: 404 })
  }

  let result
  try {
    result = await downloadFieldPhotoStream(rows[0].photo_url)
  } catch (err) {
    console.error(`[api/field/photo/${uploadId}/image] GCS read failed:`, err)
    return new Response('GCS read failed', { status: 502 })
  }

  // Convert Node ReadableStream → Web ReadableStream so the Response body
  // works in the App Router runtime.
  const webStream = nodeToWebStream(result.stream)
  const headers: Record<string, string> = {
    'Content-Type': result.contentType,
    'Cache-Control': 'private, max-age=3600',
  }
  if (result.size != null) headers['Content-Length'] = String(result.size)
  return new Response(webStream, { status: 200, headers })
}

function nodeToWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        controller.enqueue(new Uint8Array(buf))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
    cancel() {
      // Best-effort: ask the upstream stream to stop.
      const maybeDestroy = (nodeStream as unknown as { destroy?: () => void }).destroy
      if (typeof maybeDestroy === 'function') maybeDestroy.call(nodeStream)
    },
  })
}
