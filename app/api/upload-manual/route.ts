import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const instrumentName = formData.get('instrumentName') as string

    if (!file || !instrumentName) {
      return NextResponse.json({ error: 'Missing file or instrument name' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    let content = ''

    if (file.name.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse')
      const parsed = await pdfParse(buffer)
      content = parsed.text
    } else {
      content = buffer.toString('utf-8')
    }

    await supabase.from('manuals').insert({
      instrument_name: instrumentName,
      file_name: file.name,
      content: content.slice(0, 50000)
    })

    return NextResponse.json({ success: true, characters: content.length })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
  }
}
