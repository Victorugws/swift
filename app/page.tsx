'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { EnterIcon, LoadingIcon } from '@/lib/icons';
import { usePlayer } from '@/lib/usePlayer';
import { track } from '@vercel/analytics';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  latency?: number;
};

export default function Home() {
  const [user, setUser] = useState<null | { id: string; email: string | null }>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const player = usePlayer();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPending, startTransition] = useTransition();

  // Listen for auth state changes & get initial user
  useEffect(() => {
    supabaseClient.auth.getUser().then(({ data: { user } }) => {
      if (user) setUser({ id: user.id, email: user.email ?? null });
    });

    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? null });
      } else {
        setUser(null);
      }
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabaseClient.auth.signOut();
    setUser(null);
    toast.success('Signed out');
  }

  async function submit(text: string) {
    if (!user) {
      toast.error('Please sign in first');
      return;
    }

    const formData = new FormData();
    formData.append('input', text);
    messages.forEach((message) => formData.append('message', JSON.stringify(message)));

    const submittedAt = Date.now();
    const response = await fetch('/api', {
      method: 'POST',
      body: formData,
    });

    const transcript = decodeURIComponent(response.headers.get('X-Transcript') || '');
    const textResponse = decodeURIComponent(response.headers.get('X-Response') || '');

    if (!response.ok || !transcript || !textResponse || !response.body) {
      if (response.status === 429) toast.error('Too many requests. Please try again later.');
      else toast.error((await response.text()) || 'An error occurred.');
      return;
    }

    const latency = Date.now() - submittedAt;

    player.play(response.body, () => {});

    setInput(transcript);

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: transcript },
      { role: 'assistant', content: textResponse, latency },
    ];

    setMessages(newMessages);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => submit(input));
  }

  return (
    <>
      {!user ? (
        <div className="max-w-md mx-auto p-4">
          <Auth
            supabaseClient={supabaseClient}
            appearance={{ theme: ThemeSupa }}
            providers={[]} // add OAuth providers like 'google', 'github' if you want
            redirectTo={window.location.origin}
            socialLayout="horizontal"
          />
        </div>
      ) : (
        <>
          <div className="max-w-md mx-auto p-4 border rounded-md bg-neutral-100 dark:bg-neutral-900 mb-6 flex justify-between items-center">
            <span>
              Signed in as <strong>{user.email ?? 'Unknown'}</strong>
            </span>
            <button
              onClick={signOut}
              className="py-1 px-3 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Sign Out
            </button>
          </div>

          <form
            className="rounded-full bg-neutral-200/80 dark:bg-neutral-800/80 flex items-center w-full max-w-3xl border border-transparent hover:border-neutral-300 focus-within:border-neutral-400 dark:hover:border-neutral-700 dark:focus-within:border-neutral-600"
            onSubmit={handleFormSubmit}
          >
            <input
              type="text"
              className="bg-transparent focus:outline-hidden p-4 w-full placeholder:text-neutral-600 dark:placeholder:text-neutral-400"
              required
              placeholder="Ask me anything"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              ref={inputRef}
              disabled={isPending}
            />
            <button
              type="submit"
              className="p-4 text-neutral-700 hover:text-black dark:text-neutral-300 dark:hover:text-white"
              disabled={isPending}
              aria-label="Submit"
            >
              {isPending ? <LoadingIcon /> : <EnterIcon />}
            </button>
          </form>

          <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4 mx-auto">
            {messages.length > 0 ? (
              <p>
                {messages.at(-1)?.content}
                <span className="text-xs font-mono text-neutral-300 dark:text-neutral-700">
                  {' '}
                  ({messages.at(-1)?.latency}ms)
                </span>
              </p>
            ) : (
              <p>Start chatting by typing a message above.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
