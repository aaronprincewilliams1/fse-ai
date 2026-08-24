'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', {
      password,
      redirect: false
    })
    if (res?.ok) {
      router.push('/')
    } else {
      setError('Incorrect password')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mb-1">FSE AI</h1>
      <p className="text-sm text-gray-400 mb-8">Field Service Assistant</p>
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-3">
        <input
          type="password"
          placeholder="Enter password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 text-center tracking-widest"
          autoFocus
        />
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-blue-600 text-white py-3 rounded-2xl text-sm font-medium disabled:opacity-30"
        >
          {loading ? 'Checking...' : 'Enter'}
        </button>
      </form>
    </div>
  )
}
