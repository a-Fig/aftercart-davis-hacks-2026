/**
 * POST /api/field/photo
 *
 * Multipart upload for one shelf-tag or wide-shelf photo. Runs the
 * ingestPhoto() pipeline (GCS write → Gemini extraction → DB rows).
 *
 * Form fields:
 *   - photo (File)               — required; image/* MIME
 *   - store_id (string)          — required; existing stores.store_id
 *   - mode (string)              — required; 'shelf_tag' | 'wide_shot'
 *   - contributor_handle (string)— optional self-attribution
 *   - notes (string)             — optional free text
 *
 * Returns: { ok, duplicate, upload, observations[] }
 *
 * No auth gate by design: the field portal is URL-secret. If/when this
 * starts attracting spam, drop in the same INSPECTOR_PASSWORD cookie check
 * the /contribute route uses.
 */

import { NextRequest } from 'next/server'

import { ingestPhoto } from '@/lib/field/upload.mjs'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    return Response.json(
      { error: `Invalid multipart body: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  const file = formData.get('photo')
  if (!(file instanceof File)) {
    return Response.json(
      { error: 'Form field "photo" must be a file' },
      { status: 400 },
    )
  }

  const mode = String(formData.get('mode') ?? '')
  if (mode !== 'shelf_tag' && mode !== 'wide_shot' && mode !== 'online_pdf') {
    return Response.json(
      {
        error: `Form field "mode" must be 'shelf_tag' | 'wide_shot' | 'online_pdf', got "${mode}"`,
      },
      { status: 400 },
    )
  }

  // Accepted content-types depend on mode. shelf_tag / wide_shot want images;
  // online_pdf wants application/pdf. We're loose on image/* matching but
  // strict on pdf to keep the Gemini prompt input shape predictable.
  if (mode === 'online_pdf') {
    if (file.type !== 'application/pdf') {
      return Response.json(
        {
          error: `online_pdf mode requires application/pdf, got "${file.type || 'unknown'}"`,
        },
        { status: 400 },
      )
    }
  } else {
    if (!file.type || !file.type.startsWith('image/')) {
      return Response.json(
        {
          error: `Unexpected content-type "${file.type || 'unknown'}" — expected image/* for ${mode}`,
        },
        { status: 400 },
      )
    }
  }

  const storeIdRaw = String(formData.get('store_id') ?? '')
  const storeId = Number(storeIdRaw)
  if (!Number.isFinite(storeId) || storeId <= 0) {
    return Response.json(
      { error: `Form field "store_id" must be a positive integer, got "${storeIdRaw}"` },
      { status: 400 },
    )
  }

  const contributorHandle = strOrNull(formData.get('contributor_handle'))
  const notes = strOrNull(formData.get('notes'))

  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const result = await ingestPhoto({
      buffer,
      contentType: file.type,
      storeId,
      mode,
      contributorHandle,
      notes,
    })
    return Response.json({
      ok: true,
      duplicate: result.duplicate,
      upload: result.upload,
      observations: result.observations,
    })
  } catch (err) {
    console.error('[api/field/photo] ingestPhoto failed:', err)
    return Response.json(
      { error: 'Photo ingest failed', detail: (err as Error).message },
      { status: 500 },
    )
  }
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t
}
