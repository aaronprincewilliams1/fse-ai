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

    if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      content = result.value?.slice(0, 50000) || ''
    } else {
      content = buffer.toString('utf-8').slice(0, 50000)
    }

    await supabase.from('manuals').insert({
      instrument_name: instrumentName,
      file_name: file.name,
      file_url: '',
      content
    })

    return NextResponse.json({ success: true, results: [{ name: instrumentName, characters: content.length }] })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
  }
}
