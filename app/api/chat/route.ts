import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { messages } = await req.json()

  const [sites, contacts, cases, manuals, fieldNotes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('contacts').select('*').order('name'),
    supabase.from('cases').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('manuals').select('*'),
    supabase.from('field_notes').select('*').order('created_at', { ascending: false })
  ])

  const siteList = (sites.data || []).map((s: any) =>
    `ID:${s.id} | ${s.name} | ${s.address} | Lab: ${s.lab_location}`
  ).join('\n')

  const contactList = (contacts.data || []).map((c: any) => {
    const site = (sites.data || []).find((s: any) => s.id === c.site_id)
    return `${c.name} (${c.role}) at ${site?.name || 'Unknown'} | ${c.phone} | ${c.email}`
  }).join('\n')

  const caseList = (cases.data || []).map((c: any) => {
    const site = (sites.data || []).find((s: any) => s.id === c.site_id)
    return `[${new Date(c.created_at).toLocaleDateString()}] ${site?.name || 'Unknown'} | ${c.instrument_name} | Error: ${c.error_code} | ${c.error_description} | Resolution: ${c.resolution}`
  }).join('\n')

  const fieldNotesList = (fieldNotes.data || []).map((n: any) =>
    `[${new Date(n.created_at).toLocaleDateString()}] ${n.instrument_name || 'General'} | Error: ${n.error_code || 'N/A'} | ${n.note_text} | Tags: ${n.tags || ''}`
  ).join('\n')

  const manualList = (manuals.data || []).map((m: any) =>
    `ID:${m.id} | ${m.instrument_name} | file:${m.file_url || 'none'} | text:${m.content?.slice(0, 1000) || 'none'}`
  ).join('\n')

  const lastMessage = messages[messages.length - 1]
  const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : ''
  const isTroubleshooting = /error|fault|fail|not work|issue|problem|alarm|code|E\d+/i.test(lastContent)

  let apiMessages = messages.map((m: any) => ({ role: m.role, content: m.content }))

  // If troubleshooting, attach relevant PDFs for visual reading
  if (isTroubleshooting) {
    const pdfManuals = (manuals.data || []).filter((m: any) => m.file_url)
    if (pdfManuals.length > 0) {
      const pdfContents: any[] = []
      for (const manual of pdfManuals.slice(0, 2)) {
        try {
          const { data } = await supabase.storage.from('manuals').download(manual.file_url)
          if (data) {
            const buffer = Buffer.from(await data.arrayBuffer())
            const base64 = buffer.toString('base64')
            pdfContents.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 }
            })
          }
        } catch (e) {
          console.error('PDF load error:', e)
        }
      }
      if (pdfContents.length > 0) {
        apiMessages = [
          ...messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content })),
          {
            role: 'user',
            content: [
              ...pdfContents,
              { type: 'text', text: lastContent + '\n\n[Please search these PDF manuals visually for relevant error codes, tables, diagrams and troubleshooting steps. Include any images or diagrams you find relevant.]' }
            ]
          }
        ]
      }
    }
  }

  const system = `You are FSE AI, a private intelligent assistant for a medical device field service engineer.

SITES:
${siteList || 'No sites yet'}

CONTACTS:
${contactList || 'No contacts yet'}

CASE HISTORY:
${caseList || 'No cases yet'}

FIELD NOTES:
${fieldNotesList || 'No field notes yet'}

MANUALS:
${manualList || 'No manuals yet'}

CAPABILITIES:
1. SITE LOOKUP/CREATE: Check sites, create if missing
   ACTION:CREATE_SITE:{"name":"...","address":"...","lab_location":"..."}

2. CONTACT: Save contacts
   ACTION:CREATE_CONTACT:{"site_name":"...","name":"...","role":"...","phone":"...","email":"..."}

3. TROUBLESHOOTING: Search PDFs visually + case history + field notes. Be specific and practical.
   End with FIELD_NOTES_AVAILABLE:[id1,id2] if relevant notes exist.

4. LOG CASE:
   ACTION:CREATE_CASE:{"site_name":"...","instrument_name":"...","error_code":"...","error_description":"...","resolution":"...","notes":"..."}

5. SITE VISIT: Show address, lab directions, contacts, offer arrival email.

6. EMAIL: Draft professional arrival or resolution emails.

RULES:
- Be concise and practical, engineer is on site.
- Always check case history and field notes first.
- When reading PDFs, describe any relevant diagrams or images you see.
- Put ACTION tags at END of response on their own line.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages: apiMessages
    })
  })

  const data = await response.json()
  const replyText = data.content?.[0]?.text || 'Sorry, I could not get a response.'

  const actions: any[] = []
  let relatedNoteIds: string[] = []

  const notesMatch = replyText.match(/FIELD_NOTES_AVAILABLE:\[([^\]]*)\]/)
  if (notesMatch) {
    relatedNoteIds = notesMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean)
  }

  const actionRegex = /ACTION:(CREATE_SITE|CREATE_CONTACT|CREATE_CASE):(\{[^}]+\})/g
  let match
  while ((match = actionRegex.exec(replyText)) !== null) {
    const actionType = match[1]
    try {
      const payload = JSON.parse(match[2])
      if (actionType === 'CREATE_SITE') {
        const { data: newSite } = await supabase.from('sites').insert({
          name: payload.name, address: payload.address, lab_location: payload.lab_location || ''
        }).select().single()
        actions.push({ type: 'SITE_CREATED', site: newSite })
      } else if (actionType === 'CREATE_CONTACT') {
        const { data: siteData } = await supabase.from('sites')
          .select('id').ilike('name', `%${payload.site_name}%`).single()
        if (siteData) {
          await supabase.from('contacts').insert({
            site_id: siteData.id, name: payload.name, role: payload.role || '',
            phone: payload.phone || '', email: payload.email || ''
          })
          actions.push({ type: 'CONTACT_CREATED' })
        }
      } else if (actionType === 'CREATE_CASE') {
        const { data: siteData } = await supabase.from('sites')
          .select('id').ilike('name', `%${payload.site_name}%`).single()
        await supabase.from('cases').insert({
          site_id: siteData?.id || null,
          instrument_name: payload.instrument_name || '',
          error_code: payload.error_code || '',
          error_description: payload.error_description || '',
          resolution: payload.resolution || '',
          notes: payload.notes || ''
        })
        actions.push({ type: 'CASE_LOGGED' })
      }
    } catch (e) {
      console.error('Action parse error:', e)
    }
  }

  let relatedNotes: any[] = []
  if (relatedNoteIds.length > 0) {
    const { data: notesData } = await supabase.from('field_notes').select('*').in('id', relatedNoteIds)
    relatedNotes = notesData || []
  }

  const cleanReply = replyText
    .replace(/ACTION:(CREATE_SITE|CREATE_CONTACT|CREATE_CASE):\{[^}]+\}/g, '')
    .replace(/FIELD_NOTES_AVAILABLE:\[[^\]]*\]/g, '')
    .trim()

  return NextResponse.json({ reply: cleanReply, actions, relatedNotes })
}
