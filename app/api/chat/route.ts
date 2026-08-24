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

  const manualContent = (manuals.data || []).map((m: any) =>
    `=== ${m.instrument_name} MANUAL ===\n${m.content}`
  ).join('\n\n')

  const fieldNotesList = (fieldNotes.data || []).map((n: any) =>
    `[${new Date(n.created_at).toLocaleDateString()}] ${n.instrument_name || 'General'} | Error: ${n.error_code || 'N/A'} | ${n.note_text} | Tags: ${n.tags || ''}`
  ).join('\n')

  const system = `You are FSE AI, a private intelligent assistant for a medical device field service engineer. You are smart, proactive, and conversational.

CURRENT DATA:

SITES:
${siteList || 'No sites yet'}

CONTACTS:
${contactList || 'No contacts yet'}

CASE HISTORY (most recent first):
${caseList || 'No cases yet'}

FIELD NOTES (personal notes and fixes from the engineer):
${fieldNotesList || 'No field notes yet'}

MANUALS:
${manualContent || 'No manuals uploaded yet'}

---

YOUR CAPABILITIES:

1. SITE LOOKUP: If user mentions a location, check SITES. If found, show full profile (address, lab directions, contacts). If not found, ask for details to create it.

2. NEW SITE CREATION: Extract site name + address from natural language and save it.
   ACTION:CREATE_SITE:{"name":"...","address":"...","lab_location":"..."}

3. NEW CONTACT: Save contact info linked to a site.
   ACTION:CREATE_CONTACT:{"site_name":"...","name":"...","role":"...","phone":"...","email":"..."}

4. TROUBLESHOOTING: When user describes an error or symptom:
   - Search manuals for relevant info
   - Check case history for past resolutions
   - Check field notes for related personal notes
   - Give practical steps
   - If related field notes exist, end your response with FIELD_NOTES_AVAILABLE:[comma separated matching note IDs]

5. LOG A CASE: When user resolves an issue, log it.
   ACTION:CREATE_CASE:{"site_name":"...","instrument_name":"...","error_code":"...","error_description":"...","resolution":"...","notes":"..."}

6. SITE VISIT: If user says they are heading somewhere, pull up full site info and offer arrival email.

7. EMAIL DRAFTING: Draft professional arrival or resolution emails, brief and professional.

8. GENERAL: Answer anything using manuals, case history, and field notes.

---

RULES:
- Be concise. Engineer is often on-site.
- Always check field notes when troubleshooting — they contain real-world fixes.
- Distinguish between manual info and field note info in your response.
- Put ACTION or FIELD_NOTES_AVAILABLE tags on their own line at the END of your response.
- When field notes are relevant, always flag them with FIELD_NOTES_AVAILABLE.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages
    })
  })

  const data = await response.json()
  const replyText = data.content?.[0]?.text || 'Sorry, I could not get a response.'

  const actions: any[] = []
  let relatedNoteIds: string[] = []

  // Parse field notes flag
  const notesMatch = replyText.match(/FIELD_NOTES_AVAILABLE:\[([^\]]*)\]/)
  if (notesMatch) {
    relatedNoteIds = notesMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean)
  }

  // Parse and execute actions
  const actionRegex = /ACTION:(CREATE_SITE|CREATE_CONTACT|CREATE_CASE):(\{[^}]+\})/g
  let match
  while ((match = actionRegex.exec(replyText)) !== null) {
    const actionType = match[1]
    try {
      const payload = JSON.parse(match[2])
      if (actionType === 'CREATE_SITE') {
        const { data: newSite } = await supabase.from('sites').insert({
          name: payload.name,
          address: payload.address,
          lab_location: payload.lab_location || ''
        }).select().single()
        actions.push({ type: 'SITE_CREATED', site: newSite })
      } else if (actionType === 'CREATE_CONTACT') {
        const { data: siteData } = await supabase.from('sites')
          .select('id').ilike('name', `%${payload.site_name}%`).single()
        if (siteData) {
          await supabase.from('contacts').insert({
            site_id: siteData.id,
            name: payload.name,
            role: payload.role || '',
            phone: payload.phone || '',
            email: payload.email || ''
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

  // Fetch related field notes if any
  let relatedNotes: any[] = []
  if (relatedNoteIds.length > 0) {
    const { data: notesData } = await supabase
      .from('field_notes')
      .select('*')
      .in('id', relatedNoteIds)
    relatedNotes = notesData || []
  }

  // Clean tags from displayed response
  const cleanReply = replyText
    .replace(/ACTION:(CREATE_SITE|CREATE_CONTACT|CREATE_CASE):\{[^}]+\}/g, '')
    .replace(/FIELD_NOTES_AVAILABLE:\[[^\]]*\]/g, '')
    .trim()

  return NextResponse.json({ reply: cleanReply, actions, relatedNotes })
}
