import { Mail, MessageCircle, Phone } from 'lucide-react';
import { usePublicConfig } from '@/lib/publicConfig';
const BOT_AVATAR = `${import.meta.env.BASE_URL}chat-bot-avatar.webp`;

type ContactOption = 'livechat' | 'chat';

function openChat(view: ContactOption) {
  window.dispatchEvent(new CustomEvent('sbs:open-contact', { detail: { view } }));
}

function ChevronRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

export default function ContactOptions() {
  const { data: config } = usePublicConfig();
  const phoneHref = config?.phone ? `tel:${config.phone.replace(/[^\d+]/g, '')}` : undefined;
  const whatsappDigits = config?.whatsapp?.replace(/\D/g, '') ?? '';
  const whatsappHref = config?.whatsapp?.trim().startsWith('+') && /^\d{8,15}$/.test(whatsappDigits)
    ? `https://wa.me/${whatsappDigits}`
    : undefined;

  return (
    <section className="border-b border-gray-100 bg-white px-4 py-8 md:py-10" aria-labelledby="contact-options-heading">
      <div className="container mx-auto max-w-6xl">
        <h2 id="contact-options-heading" className="mb-5 text-center text-lg font-bold uppercase tracking-wide text-gray-900">
          How would you like to reach us?
        </h2>

        <div className="grid gap-3 md:grid-cols-3">
          {whatsappHref && <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex min-h-[92px] items-center gap-3 rounded-xl border-2 border-[#25D366]/30 bg-[#25D366]/5 px-4 py-3 text-left transition-all hover:border-[#25D366]/60 hover:bg-[#25D366]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] shadow-sm">
              <MessageCircle className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-snug text-gray-900">WhatsApp</p>
              <p className="mt-0.5 text-sm text-gray-500">Message us directly — fast replies</p>
            </div>
            <ChevronRight />
          </a>}
          {phoneHref && <a
            href={phoneHref}
            className="group flex min-h-[92px] items-center gap-3 rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm">
              <Phone className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-snug text-gray-900">Call us</p>
              <p className="mt-0.5 text-sm text-gray-500">{config?.phone}</p>
            </div>
            <ChevronRight />
          </a>}

          <button
            type="button"
            onClick={() => openChat('livechat')}
            className="group flex min-h-[92px] w-full items-center gap-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3 text-left transition-all hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full shadow-sm">
              <img src={BOT_AVATAR} alt="" className="h-11 w-11 object-cover" />
              <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-snug text-gray-900">Live Chat</p>
              <p className="mt-0.5 text-sm text-gray-500">Instant answers — AI assistant</p>
            </div>
            <ChevronRight />
          </button>

          <button
            type="button"
            onClick={() => openChat('chat')}
            className="group flex min-h-[92px] w-full items-center gap-3 rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-snug text-gray-900">Send a message</p>
              <p className="mt-0.5 text-sm text-gray-500">We&apos;ll reply by email within a few hours</p>
            </div>
            <ChevronRight />
          </button>
        </div>
      </div>
    </section>
  );
}