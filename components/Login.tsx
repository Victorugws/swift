'use client'

import { useState } from 'react'
import { supabaseClient } from '@/lib/supabase/client'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { error } = await supabaseClient.auth.signInWithOtp({ email })

    if (error) {
      setMessage('Error sending magic link.')
      console.error(error)
    } else {
      setMessage('Check your email for a magic login link.')
    }

    setLoading(false)
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-4 max-w-md mx-auto mt-10">
      <input
        type="email"
        placeholder="Enter your email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        className="p-2 border rounded"
      />
      <button type="submit" disabled={loading} className="bg-blue-600 text-white p-2 rounded">
        {loading ? 'Sending...' : 'Send Magic Link'}
      </button>
      {message && <p>{message}</p>}
    </form>
  )
}
