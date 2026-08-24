import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('file') as File[]
    const instrumentNames = formData.getAll('instrumentName') as string[]

    const results = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const instrumentName = instrumentNames[i] || file.name.replace(/\.[^.]+$/, '')

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      let content = ''

      if (file.name.endsWith('.pdf')) {
        const pdfParse = require('pdf-parse')
        const parsed = await pdfParse(buffer)
        content = parsed.text
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        const mammoth = require('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        content = result.value
      } else {
        content = buffer.toString('utf-8')
      }

      await supabase.from('manuals').insert({
        instrument_name: instrumentName,
        file_name: file.name,
        content: content.slice(0, 50000)
      })

      results.push({ name: instrumentName, characters: content.length })
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
  }
}
