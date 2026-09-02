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
    supabase.from('cases').select('*').order('created_at', { ascending: false }).limit(100),
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
    `ID:${n.id} | [${new Date(n.created_at).toLocaleDateString()}] ${n.instrument_name || 'General'} | Error: ${n.error_code || 'N/A'} | ${n.note_text} | Tags: ${n.tags || ''}`
  ).join('\n')

  const manualList = (manuals.data || []).map((m: any) =>
    `ID:${m.id} | ${m.instrument_name} | file:${m.file_url || 'none'}`
  ).join('\n')

  const lastMessage = messages[messages.length - 1]
  const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : ''

  // Smart instrument detection from message + case history
  const isTroubleshooting = /error|fault|fail|not work|issue|problem|alarm|code|E\d+|alert/i.test(lastContent)
  const isSiteVisit = /heading to|going to|on my way|at the|visiting|on site at/i.test(lastContent)

  // Find most relevant manual based on message content
  let relevantManual = null
  if (isTroubleshooting && manuals.data && manuals.data.length > 0) {
    // Try to match instrument name from message or recent cases
    const instrumentMentioned = (manuals.data || []).find((m: any) =>
      lastContent.toLowerCase().includes(m.instrument_name.toLowerCase())
    )
    // Fall back to most recently referenced instrument in cases
    const recentInstrument = (cases.data || []).find((c: any) =>
      lastContent.toLowerCase().includes(c.instrument_name?.toLowerCase() || '')
    )
    relevantManual = instrumentMentioned ||
      (recentInstrument ? (manuals.data || []).find((m: any) =>
        m.instrument_name.toLowerCase().includes(recentInstrument.instrument_name?.toLowerCase() || '')
      ) : null) ||
      (manuals.data || [])[0]
  }

  // Build site visit context
  let siteVisitContext = ''
  if (isSiteVisit) {
    const mentionedSite = (sites.data || []).find((s: any) =>
      lastContent.toLowerCase().includes(s.name.toLowerCase())
    )
    if (mentionedSite) {
      const siteContacts = (contacts.data || []).filter((c: any) => c.site_id === mentionedSite.id)
      const siteCases = (cases.data || []).filter((c: any) => c.site_id === mentionedSite.id)
      siteVisitContext = `
ACTIVE SITE VISIT: ${mentionedSite.name}
Address: ${mentionedSite.address}
Lab directions: ${mentionedSite.lab_location}
Contacts: ${siteContacts.map((c: any) => `${c.name} (${c.role}) - ${c.phone} - ${c.email}`).join(', ')}
Past issues at this site: ${siteCases.slice(0, 5).map((c: any) => `${c.instrument_name} Error ${c.error_code}: ${c.resolution}`).join('; ')}
Apple Maps link: https://maps.apple.com/?q=${encodeURIComponent(mentionedSite.address)}
Google Maps link: https://maps.google.com/?q=${encodeURIComponent(mentionedSite.address)}`
    }
  }

  const system = `You are FSE AI, a private intelligent assistant for a medical device field service engineer named Aaron. You are smart, proactive, and conversational. You understand natural language and figure out what Aaron needs without requiring specific commands.

SITES:
${siteList || 'No sites yet'}

CONTACTS:
${contactList || 'No contacts yet'}

CASE HISTORY (most recent first, up to 100):
${caseList || 'No cases yet'}

FIELD NOTES:
${fieldNotesList || 'No field notes yet'}

MANUALS AVAILABLE:
${manualList || 'No manuals yet'}

${siteVisitContext ? siteVisitContext : ''}

---

YOUR CAPABILITIES:

1. SITE LOOKUP/CREATE: Check sites by name. If found show full profile with address, lab directions, contacts, past issues, and maps links. If not found ask for details.
   ACTION:CREATE_SITE:{"name":"...","address":"...","lab_location":"..."}

2. CONTACT: Save contacts linked to a site.
   ACTION:CREATE_CONTACT:{"site_name":"...","name":"...","role":"...","phone":"...","email":"..."}

3. TROUBLESHOOTING: When Aaron describes an error or symptom:
   - First check case history for identical or similar past issues — lead with this if found
   - Check field notes for related personal fixes
   - Then reference the manual PDF if attached
   - Be specific and practical — give numbered steps
   - Always mention if this exact issue was seen before and what fixed it
   - If related field notes exist end with FIELD_NOTES_AVAILABLE:[id1,id2]
   - After giving troubleshooting info, ask if the issue was resolved so you can log it

4. LOG CASE: When Aaron resolves an issue log it immediately.
   ACTION:CREATE_CASE:{"site_name":"...","instrument_name":"...","error_code":"...","error_description":"...","resolution":"...","notes":"..."}

5. SITE VISIT MODE: When Aaron says he is heading to a site:
   - Show full site briefing: address, lab directions, all contacts with phone numbers
   - Show Apple Maps and Google Maps links
   - Show any past issues at that site
   - Offer to draft arrival email
   - Ask which instrument he will be working on

6. QUICK ACTIONS: When showing a site always include:
   - 📍 Maps links (Apple and Google)
   - 📞 Contact numbers (ready to call format)
   - ✉️ Offer to draft arrival or resolution email

7. EMAIL DRAFTING: Draft professional arrival or resolution emails. Keep them brief.

8. DUPLICATE MANUALS: If Aaron tries to upload a manual for an instrument that already exists warn him.

9. INSTRUMENT HISTORY: When visiting a site always show which instruments have had issues there and what was done.

RULES:
- Be concise and practical. Aaron is often on site and busy.
- Always check case history FIRST before manual — past resolutions are most valuable.
- When you detect a troubleshooting question automatically identify the instrument from context.
- After resolving an issue always prompt to log it.
- Put ACTION tags at END of response on their own line.
- FIELD_NOTES_AVAILABLE tag goes at END of response.
- Never load more than 1 PDF at a time to control costs.
- Format phone numbers as tap-to-call when showing contacts.
- When you find a relevant figure, diagram, or image in a PDF always include PAGE_IMAGE:[page_number] at the end of your response so it can be displayed. Example: PAGE_IMAGE:47
- Always specify the exact page number where a figure or diagram is located.
- When describing a procedure that has diagrams, always reference the page and include PAGE_IMAGE tag.`

  let apiMessages = messages.map((m: any) => ({ role: m.role, content: m.content }))

  // Only attach PDF if troubleshooting AND we found a relevant manual with a stored PDF
  if (isTroubleshooting && relevantManual?.file_url) {
    try {
      const { data } = await supabase.storage.from('manuals').download(relevantManual.file_url)
      if (data) {
        const buffer = Buffer.from(await data.arrayBuffer())
        const base64 = buffer.toString('base64')
        apiMessages = [
          ...messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content })),
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              },
              {
                type: 'text',
                text: lastContent + `\n\n[Attached: ${relevantManual.instrument_name} manual — search it visually for this error code, any relevant tables, diagrams, and troubleshooting steps]`
              }
            ]
          }
        ]
      }
    } catch (e) {
      console.error('PDF load error:', e)
    }
  }

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

  let relatedNotes: any[] = []
  if (relatedNoteIds.length > 0) {
    const { data: notesData } = await supabase
      .from('field_notes')
      .select('*')
      .in('id', relatedNoteIds)
    relatedNotes = notesData || []
  }

  const cleanReply = replyText
    .replace(/ACTION:(CREATE_SITE|CREATE_CONTACT|CREATE_CASE):\{[^}]+\}/g, '')
    .replace(/FIELD_NOTES_AVAILABLE:\[[^\]]*\]/g, '')
    .trim()

  return NextResponse.json({ reply: cleanReply, actions, relatedNotes })
}
