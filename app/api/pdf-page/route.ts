import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { fileUrl, pageNumber } = await req.json()

    const { data, error } = await supabase.storage.from('manuals').download(fileUrl)
    if (error || !data) {
      return NextResponse.json({ error: 'Could not download PDF' }, { status: 400 })
    }

    const buffer = Buffer.from(await data.arrayBuffer())
    const { pdf } = await import('pdf-to-img')
    
    const document = await pdf(buffer, { scale: 2 })
    
    let pageIndex = 0
    let pageImage: Buffer | null = null
    
    for await (const image of document) {
      if (pageIndex === (pageNumber - 1)) {
        pageImage = image
        break
      }
      pageIndex++
    }

    if (!pageImage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    const base64 = pageImage.toString('base64')
    return NextResponse.json({ image: base64, mimeType: 'image/png' })
  } catch (error) {
    console.error('PDF page error:', error)
    return NextResponse.json({ error: 'Failed to extract page' }, { status: 500 })
  }
}
