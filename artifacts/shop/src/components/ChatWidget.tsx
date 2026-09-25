import { useState, useRef, useEffect } from 'react';
import { X, Send, CheckCircle2, MessageCircle, Phone, Mail, Loader2 } from 'lucide-react';
import { usePublicConfig } from '@/lib/publicConfig';

const SUPPORT_AVATAR = `${import.meta.env.BASE_URL}chat-bot-avatar.webp`;

interface FormState { name: string; email: string; message: string; }
type Status = 'idle' | 'loading' | 'success' | 'error';
type View = 'choice' | 'livechat' | 'chat';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

// ── Chevron icon ──────────────────────────────────────────────────────────────
function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ── Back button ───────────────────────────────────────────────────────────────
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-1"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

// ── Live Chat view ─────────────────────────────────────────────────────────────
function LiveChatView({ onBack, whatsappConfigured }: { onBack: () => void; whatsappConfigured: boolean }) {
  const [stage, setStage] = useState<'pre-chat' | 'chatting'>('pre-chat');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;

    const endSession = () => {
      fetch('/api/shop/live-chat/session/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesRef.current, ended: true }),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener('pagehide', endSession);
    return () => {
      window.removeEventListener('pagehide', endSession);
      endSession();
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (stage === 'chatting') setTimeout(() => inputRef.current?.focus(), 80);
  }, [stage]);

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || starting) return;
    setStarting(true);
    setStartError('');
    const firstName = userName.trim().split(' ')[0];
    const greeting: ChatMessage = { role: 'assistant', content: `Hi ${firstName}! 👋 I'm your virtual assistant. What are you looking to get sorted?` };
    try {
      const res = await fetch('/api/shop/live-chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactName: userName.trim() || undefined,
          contactEmail: userEmail.trim() || undefined,
          pageUrl: window.location.href,
        }),
      });
      if (!res.ok) throw new Error('Could not create chat session');
      const data = await res.json();
      if (!data.id) throw new Error('Chat session returned no ID');
      setSessionId(data.id);
      setMessages([greeting]);
      setStage('chatting');
    } catch {
      setStartError("We couldn't start the chat. Please try again or send us a message.");
    } finally {
      setStarting(false);
    }
  };

  const persistSession = async (allMessages: ChatMessage[], ended = false) => {
    if (!sessionId) return;
    fetch('/api/shop/live-chat/session/' + sessionId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: allMessages, ended }),
    }).catch(() => {});
  };

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setThinking(true);

    try {
      const res = await fetch('/api/shop/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          userName: userName.trim() || undefined,
          userEmail: userEmail.trim() || undefined,
        }),
      });
      const data = await res.json();
      const reply: string = data.reply ?? data.error ?? "Sorry, something went wrong. Please try again.";
      const withReply = [...next, { role: 'assistant' as const, content: reply }];
      setMessages(withReply);
      persistSession(withReply);
    } catch {
      const fallback = whatsappConfigured
        ? "Sorry, I couldn't connect right now. Please try WhatsApp or send us a message."
        : "Sorry, I couldn't connect right now. Please send us a message.";
      setMessages(prev => [...prev, { role: 'assistant', content: fallback }]);
    } finally {
      setThinking(false);
    }
  };

  if (stage === 'pre-chat') {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 pt-3 pb-1 shrink-0">
          <BackButton onClick={onBack} />
        </div>
        <form onSubmit={startChat} className="flex flex-col gap-4 px-4 py-4 flex-1">
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-0.5">Before we start…</p>
            <p className="text-xs text-gray-500">Just so we know who we're talking to.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Your name *</label>
            <input
              autoFocus
              required
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="e.g. Sarah"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="email"
              value={userEmail}
              onChange={e => setUserEmail(e.target.value)}
              placeholder="you@company.com"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button
            type="submit"
            disabled={!userName.trim() || starting}
            className="mt-auto w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {starting ? 'Starting chat…' : 'Start chat →'}
          </button>
          {startError && <p className="text-xs text-red-600 text-center">{startError}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-1 shrink-0">
        <BackButton onClick={onBack} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <img src={SUPPORT_AVATAR} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 mr-2 mt-0.5" />
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <img src={SUPPORT_AVATAR} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 mr-2 mt-0.5" />
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type a message…"
            disabled={thinking}
            className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking}
            className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-1.5">Virtual assistant · the configured business customer adviser</p>
      </div>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────
export default function ChatWidget() {
  const { data: config } = usePublicConfig();
  const phoneHref = config?.phone ? `tel:${config.phone.replace(/[^\d+]/g, '')}` : undefined;
  const whatsappDigits = config?.whatsapp?.replace(/\D/g, '') ?? '';
  const whatsappHref = config?.whatsapp?.trim().startsWith('+') && /^\d{8,15}$/.test(whatsappDigits)
    ? `https://wa.me/${whatsappDigits}`
    : undefined;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('choice');
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<Status>('idle');
  const [refNum, setRefNum] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleExternalOpen = (event: Event) => {
      const requestedView = (event as CustomEvent<{ view?: View }>).detail?.view;
      if (requestedView !== 'livechat' && requestedView !== 'chat') return;

      setForm({ name: '', email: '', message: '' });
      setStatus('idle');
      setRefNum('');
      setView(requestedView);
      setOpen(true);
    };

    window.addEventListener('sbs:open-contact', handleExternalOpen);
    return () => window.removeEventListener('sbs:open-contact', handleExternalOpen);
  }, []);

  useEffect(() => {
    if (open && view === 'chat' && status === 'idle') {
      setTimeout(() => messageRef.current?.focus(), 120);
    }
  }, [open, view, status]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/shop/product-enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: form.email, message: form.message, source: 'chat' }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setRefNum(data.referenceNumber ?? '');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const reset = () => { setForm({ name: '', email: '', message: '' }); setStatus('idle'); setRefNum(''); };
  const handleClose = () => { setOpen(false); };
  const handleOpen = () => { setView('choice'); reset(); setOpen(true); };

  return (
    <div className="fixed bottom-4 md:bottom-6 right-4 md:right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="w-[calc(100vw-2rem)] sm:w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[calc(100vh-100px)]"
          style={{ height: view === 'livechat' ? '480px' : '520px' }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                <img src={SUPPORT_AVATAR} alt="" className="w-8 h-8 object-cover" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-none">Get in touch</p>
                <p className="text-xs text-white/70 mt-0.5 leading-none">We're here to help</p>
              </div>
            </div>
            <button onClick={handleClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {view === 'choice' && (
              <div className="p-5 space-y-3">
                <p className="text-sm text-gray-500 mb-4">How would you like to reach us?</p>

                {whatsappHref && <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-[#25D366]/30 bg-[#25D366]/5 hover:bg-[#25D366]/10 hover:border-[#25D366]/60 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center shrink-0 shadow-sm">
                    <MessageCircle className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">WhatsApp</p>
                    <p className="text-xs text-gray-500 mt-0.5">Message us directly — fast replies</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-[#25D366] transition-colors shrink-0" />
                </a>}

                {/* Configured business phone */}
                {phoneHref && <a
                  href={phoneHref}
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
                    <Phone className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">Call us</p>
                    <p className="text-xs text-gray-500 mt-0.5">{config?.phone}</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                </a>}

                {/* Live Chat */}
                <button
                  onClick={() => setView('livechat')}
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="relative w-10 h-10 rounded-full overflow-hidden shrink-0 shadow-sm">
                    <img src={SUPPORT_AVATAR} alt="" className="w-10 h-10 object-cover" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">Live Chat with our assistant</p>
                    <p className="text-xs text-gray-500 mt-0.5">Chat now — practical answers, without the fuss</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors shrink-0" />
                </button>

                {/* Send a message */}
                <button
                  onClick={() => { reset(); setView('chat'); }}
                  className="flex items-center gap-3.5 w-full rounded-xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all px-4 py-3.5 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">Send a message</p>
                    <p className="text-xs text-gray-500 mt-0.5">We'll reply by email within a few hours</p>
                  </div>
                  <Chevron className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                </button>
              </div>
            )}

            {view === 'livechat' && (
              <LiveChatView onBack={() => setView('choice')} whatsappConfigured={Boolean(whatsappHref)} />
            )}

            {view === 'chat' && (
              <div className="p-4 overflow-y-auto flex-1">
                {status === 'success' ? (
                  <div className="text-center py-6 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Message sent!</p>
                      <p className="text-sm text-gray-500 mt-1">We'll get back to you shortly.</p>
                      {refNum && <p className="text-xs text-gray-400 mt-1">Ref: {refNum}</p>}
                    </div>
                    <button onClick={() => setView('choice')} className="text-sm text-primary font-medium hover:underline">
                      ← Back
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <BackButton onClick={() => { reset(); setView('choice'); }} />

                    <p className="text-sm text-gray-500">
                      Send us a message and we'll get back to you soon.
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Your name *</label>
                      <input name="name" value={form.name} onChange={handleChange} required placeholder="Jane Smith"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Email address *</label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} required placeholder="jane@company.com"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Message *</label>
                      <textarea ref={messageRef} name="message" value={form.message} onChange={handleChange} required rows={3}
                        placeholder="How can we help?"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none" />
                    </div>

                    {status === 'error' && (
                      <p className="text-xs text-red-600">Something went wrong — please try again.</p>
                    )}

                    <button type="submit" disabled={status === 'loading'}
                      className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60">
                      {status === 'loading'
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                        : <><Send className="w-4 h-4" /> Send message</>
                      }
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bubble toggle */}
      <button
        onClick={() => open ? handleClose() : handleOpen()}
        className="flex items-center gap-2 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
        style={{ padding: open ? '12px' : '12px 20px 12px 16px' }}
        aria-label="Chat with us"
      >
        {open
          ? <X className="w-5 h-5" />
          : <><img src={SUPPORT_AVATAR} alt="" className="w-5 h-5 rounded-full object-cover" /><span className="text-sm font-bold">Chat with Us</span></>
        }
      </button>
    </div>
  );
}
