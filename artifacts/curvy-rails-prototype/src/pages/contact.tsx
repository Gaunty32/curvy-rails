import { useState, type FormEvent } from 'react';
import { PageShell } from '@/components/page-shell';
import { saveLocal } from '@/data/local-forms';

export default function Contact() {
  const [f, setF] = useState({ name: '', email: '', message: '' });
  const [done, setDone] = useState(false);
  const [saveError, setSaveError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saveLocal('messages', f)) {
      setDone(true);
      setF({ name: '', email: '', message: '' });
      setSaveError('');
    } else {
      setSaveError('This browser could not save your message. Check that local storage is available, then try again.');
    }
  };
  const field = 'mt-1 min-h-12 w-full border border-black bg-white p-3 text-base';
  return (
    <PageShell title="Contact" description="Contact Curvy Rails. This demo form saves your message in your browser only." heading="Contact" intro="Questions about sizing or the range? Drop us a line.">
      {done ? <p data-testid="text-contact-done" className="border border-black p-4 text-sm font-semibold">Saved in this browser only (demo). Your message has not been sent to anyone.</p> : (
        <form onSubmit={submit} className="max-w-xl space-y-4">
          <label className="block text-sm font-semibold">Name<input data-testid="input-name" required className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Email<input data-testid="input-email" required type="email" className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Message<textarea data-testid="input-message" required rows={5} className={field} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
          <button data-testid="button-send" className="h-12 w-full bg-black px-8 sm:w-auto text-xs font-bold uppercase tracking-widest text-white">Send (demo)</button>
          <p className="text-xs text-muted-foreground">Demo form: submissions are stored in your own browser and go nowhere.</p>
          {saveError && <p role="alert" className="text-sm font-semibold text-red-800">{saveError}</p>}
        </form>
      )}
    </PageShell>
  );
}
