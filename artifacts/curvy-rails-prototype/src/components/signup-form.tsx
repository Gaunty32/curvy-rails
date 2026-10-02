import { useState, type FormEvent } from 'react';
import { saveLocal } from '@/data/local-forms';

export function SignupForm({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); saveLocal('signups', { email }); setDone(true); setEmail(''); };
  if (done) return <p data-testid="text-signup-done" className="text-sm font-semibold">Saved in this browser only (demo). No email has been sent or stored on a server.</p>;
  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <input data-testid="input-signup-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email address" aria-label="Email address"
        className={`h-12 min-w-0 flex-1 border px-3 text-base ${dark ? 'bg-white text-black' : 'bg-white'}`} />
      <button data-testid="button-signup" className="h-12 bg-black px-6 text-sm font-bold uppercase tracking-wide text-white">Join</button>
    </form>
  );
}
