'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Mic, MicOff, Send, Upload, Search, X, Plus, ChevronDown, ChevronUp } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  relatedNotes?: FieldNote[]
}

interface Site {
  id: string
  name: string
  address: string
  lab_location: string
}

interface FieldNote {
  id: string
  instrument_name: string
  error_code: string
  note_text: string
  image_url: string
  tags: string
  created_at: string
}

export default function FSEAi() {
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [recentSites, setRecentSites] = useState<Site[]>([])
  const [started, setStarted] = useState(false)
  const [expandedNotes, setExpandedNotes] = useState<number | null>(null)
  const [noteListening, setNoteListening] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [newNote, setNewNote] = useState({ instrument_name: '', error_code: '', note_text: '', tags: '' })
  const [noteImage, setNoteImage] = useState<File | null>(null)
  const [addingNote, setAddingNote] = useState(false)
  const [viewportHeight, setViewportHeight] = useState('100dvh')
  const [isDragging, setIsDragging] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fieldNoteImageRef = useRef<HTMLInputElement>(null)
  const noteImageRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const noteListenRef = useRef<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadRecentSites()

    // Fix for mobile keyboard pushing content
    function handleResize() {
      if (window.visualViewport) {
        setViewportHeight(`${window.visualViewport.height}px`)
      }
    }
    window.visualViewport?.addEventListener('resize', handleResize)
    handleResize()
    return () => window.visualViewport?.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadRecentSites() {
    const { data } = await supabase.from('sites').select('*').order('created_at', { ascending: false }).limit(4)
    if (data) setRecentSites(data)
  }

  async function loadMessages() {
    const { data } = await supabase.from('conversations').select('*').order('created_at', { ascending: true }).limit(100)
    if (data && data.length > 0) {
      setMessages(data.map((m: any) => ({ role: m.role, content: m.content })))
      setStarted(true)
    }
    setMessagesLoading(false)
  }

  async function saveMessage(msg: Message) {
    await supabase.from('conversations').insert({ role: msg.role, content: msg.content })
  }

  async function clearMessages() {
    await supabase.from('conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setMessages([])
    setStarted(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const manualFiles = files.filter(f =>
      f.name.endsWith('.pdf') || f.name.endsWith('.docx') || f.name.endsWith('.doc') || f.name.endsWith('.txt')
    )
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (manualFiles.length > 0) {
      const fakeEvent = { target: { files: manualFiles, value: '' }, preventDefault: () => {} } as any
      Object.defineProperty(fakeEvent.target, 'files', { value: manualFiles })
      handleManualUploadFiles(manualFiles)
    } else if (imageFiles.length > 0) {
      handleImageFile(imageFiles[0])
    }
  }

  async function handleManualUploadFiles(files: File[]) {
    if (!files.length) return
    setStarted(true)
    setLoading(true)
    const instrumentName = files.length === 1
      ? window.prompt('What instrument is this manual for?', files[0].name.replace(/\.[^.]+$/, '')) || ''
      : window.prompt(`Uploading ${files.length} files. What instrument are these manuals for?`) || ''
    if (!instrumentName) { setLoading(false); return }
    try {
      const results = []
      for (const file of files) {
        const name = files.length === 1 ? instrumentName : `${instrumentName} - ${file.name.replace(/\.[^.]+$/, '')}`
        if (file.name.endsWith('.pdf')) {
          setMessages(prev => [...prev, { role: 'assistant', content: `⏳ Uploading ${file.name}...` }])
          const fileName = `${Date.now()}-${file.name}`
          const { error: storageError } = await supabase.storage
            .from('manuals')
            .upload(fileName, file, { contentType: 'application/pdf' })
          if (storageError) throw storageError
          await supabase.from('manuals').insert({
            instrument_name: name,
            file_name: file.name,
            file_url: fileName,
            content: ''
          })
          results.push({ name })
        } else {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('instrumentName', name)
          const res = await fetch('/api/upload-manual', { method: 'POST', body: formData })
          const data = await res.json()
          if (data.success) results.push(...data.results)
        }
      }
      const summary = results.map((r: any) => `• ${r.name}`).join('\n')
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ ${results.length} manual${results.length > 1 ? 's' : ''} uploaded:\n${summary}\n\nI will read these PDFs visually when you ask about errors.`
      }])
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error uploading manual. Please try again.' }])
    }
    setLoading(false)
  }

  async function handleImageFile(file: File) {
    setStarted(true)
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      const userMsg: Message = { role: 'user', content: '📷 Photo of error message sent' }
      const updated = [...messages, userMsg]
      setMessages(updated)
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              ...messages.map(m => ({ role: m.role, content: m.content })),
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
                  { type: 'text', text: 'This is a photo of an error on a medical instrument. What does this error mean? Check the manuals and case history for troubleshooting steps and past resolutions.' }
                ]
              }
            ]
          })
        })
        const data = await res.json()
        setMessages([...updated, { role: 'assistant', content: data.reply, relatedNotes: data.relatedNotes || [] }])
      } catch {
        setMessages([...updated, { role: 'assistant', content: 'Error analyzing image.' }])
      }
      setLoading(false)
    }
    reader.readAsDataURL(file)
  }

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return
    setStarted(true)
    setLoading(true)
    setInput('')
    const userMsg: Message = { role: 'user', content }
    const updated = [...messages, userMsg]
    setMessages(updated)

    try {
      await saveMessage(userMsg)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated.map(m => ({ role: m.role, content: m.content }))
        })
      })
      const data = await res.json()
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.reply,
        relatedNotes: data.relatedNotes || []
      }
      await saveMessage({ role: 'assistant', content: data.reply })
      setMessages([...updated, assistantMsg])
      if (data.actions?.some((a: any) => a.type === 'SITE_CREATED')) loadRecentSites()
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'Connection error. Please try again.' }])
    }
    setLoading(false)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStarted(true)
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      const userMsg: Message = { role: 'user', content: '📷 Photo of error message sent' }
      const updated = [...messages, userMsg]
      setMessages(updated)
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              ...messages.map(m => ({ role: m.role, content: m.content })),
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
                  { type: 'text', text: 'This is a photo of an error on a medical instrument. What does this error mean? Check the manuals and case history for troubleshooting steps and past resolutions.' }
                ]
              }
            ]
          })
        })
        const data = await res.json()
        setMessages([...updated, {
          role: 'assistant',
          content: data.reply,
          relatedNotes: data.relatedNotes || []
        }])
      } catch {
        setMessages([...updated, { role: 'assistant', content: 'Error analyzing image.' }])
      }
      setLoading(false)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleManualUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setStarted(true)
    setLoading(true)

    const instrumentName = files.length === 1
      ? window.prompt('What instrument is this manual for?', files[0].name.replace(/\.[^.]+$/, '')) || ''
      : window.prompt(`Uploading ${files.length} files. What instrument are these manuals for?`) || ''
    if (!instrumentName) { setLoading(false); return }

    try {
      const results = []
      for (const file of files) {
        const name = files.length === 1 ? instrumentName : `${instrumentName} - ${file.name.replace(/\.[^.]+$/, '')}`
        if (file.name.endsWith('.pdf')) {
          setMessages(prev => [...prev, { role: 'assistant', content: `⏳ Uploading ${file.name}...` }])
          const fileName = `${Date.now()}-${file.name}`
          const { error: storageError } = await supabase.storage
            .from('manuals')
            .upload(fileName, file, { contentType: 'application/pdf' })
          if (storageError) throw storageError
          await supabase.from('manuals').insert({
            instrument_name: name,
            file_name: file.name,
            file_url: fileName,
            content: ''
          })
          results.push({ name })
        } else {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('instrumentName', name)
          const res = await fetch('/api/upload-manual', { method: 'POST', body: formData })
          const data = await res.json()
          if (data.success) results.push(...data.results)
        }
      }
      const summary = results.map((r: any) => `• ${r.name}`).join('\n')
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ ${results.length} manual${results.length > 1 ? 's' : ''} uploaded:\n${summary}\n\nI will read these PDFs visually when you ask about errors.`
      }])
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error uploading manual. Please try again.' }])
    }
    setLoading(false)
    e.target.value = ''
  }

  async function handleFieldNoteImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStarted(true)
    setLoading(true)
    const instrumentName = window.prompt('What instrument does this field note relate to?') || ''
    const errorCode = window.prompt('Error code? (leave blank if none)') || ''
    const tags = window.prompt('Any tags? (e.g. power, reagent)') || ''
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
                { type: 'text', text: 'Extract and transcribe all text from this image. This is a field note about fixing a medical instrument. Return only the transcribed text, nothing else.' }
              ]
            }]
          })
        })
        const data = await res.json()
        await supabase.from('field_notes').insert({
          instrument_name: instrumentName,
          error_code: errorCode,
          note_text: data.reply || 'Image note',
          tags,
          image_url: ''
        })
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Field note saved.\n\n📋 Extracted:\n${data.reply}`
        }])
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error processing field note.' }])
      }
      setLoading(false)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function saveFieldNote() {
    if (!newNote.note_text.trim() && !noteImage) return
    setAddingNote(true)
    if (noteImage) {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1]
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: noteImage.type, data: base64 } },
                { type: 'text', text: 'Extract and transcribe all text from this image. Return only the transcribed text.' }
              ]
            }]
          })
        })
        const data = await res.json()
        await supabase.from('field_notes').insert({
          ...newNote,
          note_text: newNote.note_text || data.reply || 'Image note',
          image_url: ''
        })
        setNewNote({ instrument_name: '', error_code: '', note_text: '', tags: '' })
        setNoteImage(null)
        setShowAddNote(false)
        setAddingNote(false)
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ Field note saved.' }])
        setStarted(true)
      }
      reader.readAsDataURL(noteImage)
      return
    }
    await supabase.from('field_notes').insert({ ...newNote, image_url: '' })
    setNewNote({ instrument_name: '', error_code: '', note_text: '', tags: '' })
    setNoteImage(null)
    setShowAddNote(false)
    setAddingNote(false)
    setMessages(prev => [...prev, { role: 'assistant', content: '✅ Field note saved.' }])
    setStarted(true)
  }

  function startListening(target: 'chat' | 'note') {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Use Chrome or Safari for voice input.'); return }
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    if (target === 'chat') {
      recognition.onresult = (e: any) => { setListening(false); sendMessage(e.results[0][0].transcript) }
      recognition.onerror = () => setListening(false)
      recognition.onend = () => setListening(false)
      recognitionRef.current = recognition
      setListening(true)
    } else {
      recognition.onresult = (e: any) => {
        setNoteListening(false)
        setNewNote(prev => ({ ...prev, note_text: prev.note_text + ' ' + e.results[0][0].transcript }))
      }
      recognition.onerror = () => setNoteListening(false)
      recognition.onend = () => setNoteListening(false)
      noteListenRef.current = recognition
      setNoteListening(true)
    }
    recognition.start()
  }

  function clearChat() {
    clearMessages()
  }

  function speakText(text: string) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    if (speaking) { setSpeaking(false); return }
    const clean = text.replace(/ACTION:[^
]*/g, '').replace(/[#*]/g, '').trim()
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  function renderMessageContent(text: string) {
    const appleMapRegex = /https://maps.apple.com/?q=[^s]*/g
    const googleMapRegex = /https://maps.google.com/?q=[^s]*/g
    const parts = text.split(/(https://maps.[^s]*)/g)
    return parts.map((part, i) => {
      if (part.match(/https://maps.apple.com/)) {
        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg text-xs font-medium">📍 Apple Maps</a>
      }
      if (part.match(/https://maps.google.com/)) {
        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-lg text-xs font-medium">🗺️ Google Maps</a>
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div
      className={`bg-white flex flex-col max-w-xl mx-auto overflow-hidden transition-all ${isDragging ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
      style={{ height: viewportHeight }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50 bg-opacity-90 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl mb-2">📄</p>
            <p className="text-blue-600 font-medium">Drop to upload</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="pt-6 pb-3 px-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">FSE AI</h1>
          <p className="text-sm text-gray-400 mt-0.5">Field Service Assistant</p>
        </div>
        <button
          onClick={() => setShowAddNote(!showAddNote)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
        >
          <Plus size={15} />
          Note
        </button>
      </div>

      {/* Add Field Note Panel */}
      {showAddNote && (
        <div className="mx-4 border border-gray-200 rounded-2xl p-4 mb-2 space-y-3 bg-gray-50 shrink-0">
          <p className="text-sm font-medium text-gray-700">New Field Note</p>
          <input
            placeholder="Instrument name"
            value={newNote.instrument_name}
            onChange={e => setNewNote({ ...newNote, instrument_name: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
          />
          <input
            placeholder="Error code (optional)"
            value={newNote.error_code}
            onChange={e => setNewNote({ ...newNote, error_code: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
          />
          <div className="relative">
            <textarea
              placeholder="Describe the fix..."
              value={newNote.note_text}
              onChange={e => setNewNote({ ...newNote, note_text: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white resize-none"
              rows={3}
            />
            <button
              onClick={() => noteListening ? noteListenRef.current?.stop() : startListening('note')}
              className={`absolute right-2 bottom-2 p-1.5 rounded-lg ${noteListening ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              {noteListening ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
          </div>
          <input
            placeholder="Tags (e.g. power, reagent)"
            value={newNote.tags}
            onChange={e => setNewNote({ ...newNote, tags: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => noteImageRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-200 text-gray-600 hover:bg-gray-300"
            >
              <Upload size={13} />
              {noteImage ? noteImage.name.slice(0, 20) + '...' : 'Upload Photo'}
            </button>
            <input ref={noteImageRef} type="file" accept="image/*" className="hidden" onChange={e => setNoteImage(e.target.files?.[0] || null)} />
          </div>
          <div className="flex gap-2">
            <button onClick={saveFieldNote} disabled={addingNote} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50">
              {addingNote ? 'Saving...' : 'Save Note'}
            </button>
            <button onClick={() => setShowAddNote(false)} className="text-gray-400 text-sm px-3 py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!started && recentSites.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Recent Sites</p>
            <div className="space-y-2">
              {recentSites.map(site => (
                <button
                  key={site.id}
                  onClick={() => sendMessage(`I'm heading to ${site.name} today`)}
                  className="w-full text-left border border-gray-100 rounded-xl px-4 py-3 hover:border-blue-200 hover:bg-blue-50 transition-all group"
                >
                  <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{site.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{site.address}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {!started && recentSites.length === 0 && (
          <div className="mt-6 space-y-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Try saying...</p>
            {[
              "I'm heading to Cedars-Sinai today",
              "Error E55 on the Sysmex XN",
              "Add new site: UCLA Medical 10833 Le Conte Ave",
              "Draft an arrival email for my next visit"
            ].map((hint, i) => (
              <button
                key={i}
                onClick={() => sendMessage(hint)}
                className="w-full text-left px-4 py-2.5 rounded-xl border border-gray-100 text-sm text-gray-500 hover:border-blue-200 hover:text-blue-600 hover:bg-blue-50 transition-all"
              >
                {hint}
              </button>
            ))}
          </div>
        )}

        {started && (
          <div className="space-y-4 py-2">
            <div className="flex justify-end">
              <button onClick={clearChat} className="text-xs text-red-400 hover:text-red-600">Clear chat</button>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  {m.role === 'assistant' ? renderMessageContent(m.content) : m.content}
                </div>
                {m.role === 'assistant' && (
                  <button
                    onClick={() => speakText(m.content)}
                    className="mt-1 flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors"
                  >
                    {speaking ? '⏹ Stop' : '🔊 Listen'}
                  </button>
                )}
                {m.role === 'assistant' && m.relatedNotes && m.relatedNotes.length > 0 && (
                  <div className="mt-2 w-full max-w-xs lg:max-w-sm">
                    <button
                      onClick={() => setExpandedNotes(expandedNotes === i ? null : i)}
                      className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs font-medium text-amber-700 hover:bg-amber-100 transition-all w-full"
                    >
                      📋 {m.relatedNotes.length} Related Field Note{m.relatedNotes.length > 1 ? 's' : ''}
                      {expandedNotes === i ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
                    </button>
                    {expandedNotes === i && (
                      <div className="mt-2 space-y-2">
                        {m.relatedNotes.map(note => (
                          <div key={note.id} className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-amber-800">{note.instrument_name}</span>
                              {note.error_code && <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">Error {note.error_code}</span>}
                              <span className="text-xs text-amber-500 ml-auto">{new Date(note.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-xs text-gray-700 leading-relaxed">{note.note_text}</p>
                            {note.tags && <p className="text-xs text-amber-500 mt-1">#{note.tags}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input fixed at bottom — stays above keyboard */}
      <div className="shrink-0 px-4 pb-4 pt-2 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-2 border border-gray-200 rounded-2xl px-4 py-3 shadow-sm bg-white focus-within:border-blue-400 transition-colors">
          <Search size={16} className="text-gray-300 shrink-0" />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
            }}
            onPaste={e => {
              const items = Array.from(e.clipboardData.items)
              const imageItem = items.find(item => item.type.startsWith('image/'))
              if (imageItem) {
                e.preventDefault()
                const file = imageItem.getAsFile()
                if (file) handleImageFile(file)
              }
            }}
            placeholder="Site name, error code, or ask anything..."
            className="flex-1 text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none bg-transparent leading-snug"
            rows={1}
          />
          {input && <button onClick={() => setInput('')} className="text-gray-300 hover:text-gray-500"><X size={14} /></button>}
        </div>

        <div className="flex gap-2 mt-2 flex-wrap">
          <button
            onClick={() => listening ? recognitionRef.current?.stop() : startListening('chat')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${listening ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {listening ? <MicOff size={15} /> : <Mic size={15} />}
            {listening ? 'Stop' : 'Speak'}
          </button>
          <button onClick={() => imageInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
            <Upload size={15} />Photo
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
            <Upload size={15} />Manual
          </button>
          <button onClick={() => fieldNoteImageRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
            <Upload size={15} />Field Note
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30"
          >
            <Send size={15} />Enter
          </button>
        </div>

        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        <input ref={fileInputRef} type="file" accept=".txt,.pdf,.doc,.docx" multiple className="hidden" onChange={handleManualUpload} />
        <input ref={fieldNoteImageRef} type="file" accept="image/*" className="hidden" onChange={handleFieldNoteImageUpload} />
      </div>
    </div>
  )
}
