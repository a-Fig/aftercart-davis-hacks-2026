import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const { barcode } = await params
  if (!/^\d{8,14}$/.test(barcode)) {
    return new NextResponse(null, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=image_front_url`,
      { headers: { 'User-Agent': 'AfterCart/1.0 (receipt-price-comparison)' } }
    )

    if (!res.ok) {
      return new NextResponse(null, { status: 404 })
    }

    const data = await res.json()
    const imageUrl = data?.product?.image_front_url

    if (!imageUrl) {
      return new NextResponse(null, { status: 404 })
    }

    return NextResponse.redirect(imageUrl, 302)
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
