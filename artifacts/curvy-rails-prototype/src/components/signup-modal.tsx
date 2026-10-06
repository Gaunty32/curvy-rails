import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { saveLocal } from '@/data/local-forms';
import { asset } from '@/data/catalogue';

type Popup = 'signup' | 'rewards' | null;
type SignupModalContextValue = { openSignup: () => void; openRewards: () => void };
const SignupModalContext = createContext<SignupModalContextValue | null>(null);
const DISMISSED_KEY = 'cr.signup.dismissed';
const AUTO_SHOWN_KEY = 'cr.signup.auto-shown';

export function useSignupModal() {
  const context = useContext(SignupModalContext);
  if (!context) throw new Error('useSignupModal must be used inside SignupModalProvider');
  return context;
}

export function SignupModalProvider({ children }: { children: ReactNode }) {
  const [popup, setPopup] = useState<Popup>(null);
  const [location] = useLocation();
  const timerRef = useRef<number | null>(null);

  const openSignup = () => {
    try { localStorage.setItem(AUTO_SHOWN_KEY, '1'); } catch { /* Preview can still be opened. */ }
    setPopup('signup');
  };
  const openRewards = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    try { localStorage.setItem(AUTO_SHOWN_KEY, '1'); } catch { /* Preview can still be opened. */ }
    setPopup('rewards');
  };
  const contextValue = useMemo(() => ({ openSignup, openRewards }), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === '1') {
      openSignup();
      return;
    }
    if (params.get('rewards') === '1') {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setPopup('rewards');
      return;
    }
    if (location === '/admin' || location === '/basket') return;

    let dismissed = false;
    let shown = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
      shown = localStorage.getItem(AUTO_SHOWN_KEY) === '1';
    } catch { /* Storage-disabled browsers can still use the manual trigger. */ }
    if (dismissed || shown) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      try { localStorage.setItem(AUTO_SHOWN_KEY, '1'); } catch { /* no-op */ }
      setPopup('signup');
    }, 4000);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [location]);

  const onOpenChange = (open: boolean) => {
    if (open) return;
    if (popup === 'signup') {
      try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* Closing is still allowed. */ }
    }
    setPopup(null);
  };

  return (
    <SignupModalContext.Provider value={contextValue}>
      {children}
      <Dialog open={popup !== null} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={popup === 'signup' ? 'signup-dialog-description' : 'rewards-dialog-description'}
          className={`max-h-[min(92dvh,900px)] w-[calc(100%-1rem)] max-w-[1000px] overflow-y-auto rounded-none border-2 border-black p-0 shadow-[12px_12px_0_rgba(0,0,0,.28)] sm:w-[calc(100%-2rem)] ${popup === 'rewards' ? 'max-w-[760px] bg-[#f5f2eb] text-[#171716]' : 'bg-[#171716] text-[#f5f2eb]'}`}
          data-testid={`dialog-${popup ?? 'closed'}`}
        >
          {popup === 'signup' && <SignupContents />}
          {popup === 'rewards' && <RewardsContents onJoin={openSignup} />}
        </DialogContent>
      </Dialog>
    </SignupModalContext.Provider>
  );
}

function SignupContents() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) next.phone = 'Enter a valid phone number, including the area or country code.';
    if (dob && dob > today) next.dob = 'Date of birth cannot be in the future.';
    setErrors(next);
    setSaveError('');
    if (Object.keys(next).length) {
      const firstInvalid = Object.keys(next)[0];
      document.getElementById(`signup-${firstInvalid}`)?.focus();
      return;
    }
    const didSave = saveLocal('signups', {
      email: email.trim(),
      phone: phone.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dob,
      emailMarketing: String(emailOptIn),
      smsMarketing: String(smsOptIn),
      recordType: 'preview-only',
    });
    if (didSave) setSaved(true);
    else setSaveError('This browser could not save your preview entry. Check that local storage is available, then try again. Nothing has been submitted.');
  };

  if (saved) {
    return (
      <div className="flex min-h-[420px] flex-col justify-center bg-[#f5f2eb] p-7 text-[#171716] sm:p-12" data-testid="status-signup-saved">
        <span className="mb-6 flex h-12 w-12 items-center justify-center bg-black text-white"><Check aria-hidden="true" /></span>
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em]">Preview entry saved</p>
        <DialogTitle className="font-display mt-3 text-4xl uppercase sm:text-6xl">Preview noted.</DialogTitle>
        <DialogDescription id="signup-dialog-description" className="mt-5 max-w-lg text-base leading-relaxed !text-neutral-700">
          Your details and choices are saved in this browser only. This is a demo — there is no real subscription, discount or customer account, and no email or SMS has been sent.
        </DialogDescription>
      </div>
    );
  }

  const fieldClass = 'mt-1 h-12 w-full border border-white/50 bg-white px-3 text-base text-black outline-none transition-shadow focus:border-white focus:ring-2 focus:ring-white/30';
  return (
    <div className="grid min-h-[min(78dvh,720px)] md:grid-cols-[.88fr_1.12fr]">
      <div className="relative h-36 overflow-hidden bg-black sm:h-44 md:hidden">
        <img src={asset('assets/patience-sold-separately-model.webp')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[center_38%] opacity-85" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/10 to-transparent" />
        <p className="font-display absolute bottom-4 left-5 text-3xl uppercase leading-none text-white">Curvy Rails<br />The Rails</p>
      </div>
      <div className="relative hidden min-h-[620px] overflow-hidden bg-black md:block">
          <img src={asset('assets/patience-sold-separately-model.webp')} alt="Curvy Rails model wearing the Patience Sold Separately tee" className="absolute inset-0 h-full w-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
        <div className="absolute inset-x-0 bottom-0 p-8 text-white">
          <p className="text-[11px] font-extrabold uppercase tracking-[.22em]">Curvy Rails / The Rails</p>
          <p className="font-display mt-3 text-4xl uppercase leading-[.92]">Made for curves.<br />Made with you.</p>
        </div>
      </div>
      <div className="relative bg-[#171716] px-5 pb-6 pt-10 text-[#f5f2eb] sm:px-9 sm:pb-8 sm:pt-11">
        <div className="mb-5 inline-flex border border-[#f5f2eb] bg-[#f5f2eb] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.15em] text-black">Preview only · no live sign-up</div>
        <p className="text-[11px] font-extrabold uppercase tracking-[.2em]">A little something for the community</p>
        <DialogTitle className="font-display mt-2 text-[clamp(2.5rem,10vw,4.8rem)] uppercase leading-[.83]">Mystery<br className="hidden sm:block" /> offer</DialogTitle>
        <DialogDescription id="signup-dialog-description" className="mt-4 text-sm leading-relaxed !text-neutral-300">
          Get updates from Curvy Rails and The Rails. <strong className="text-white">Offer to be confirmed.</strong> Any future points, offer or reward rules are not set yet.
        </DialogDescription>

        <form noValidate onSubmit={submit} className="mt-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide" htmlFor="signup-email">Email address <span aria-hidden="true">*</span>
              <input id="signup-email" data-testid="input-signup-email" className={fieldClass} type="email" required autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((old) => ({ ...old, email: '' })); }} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'signup-email-error' : undefined} placeholder="you@example.com" />
              {errors.email && <span id="signup-email-error" className="mt-1 block text-xs font-semibold text-red-300">{errors.email}</span>}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide" htmlFor="signup-phone">Phone number <span aria-hidden="true">*</span>
              <input id="signup-phone" data-testid="input-signup-phone" className={fieldClass} type="tel" required autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setErrors((old) => ({ ...old, phone: '' })); }} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'signup-phone-error' : undefined} placeholder="+44 ..." />
              {errors.phone && <span id="signup-phone-error" className="mt-1 block text-xs font-semibold text-red-300">{errors.phone}</span>}
            </label>
          </div>
          <details className="group border-y border-white/25 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-extrabold uppercase tracking-wide [&::-webkit-details-marker]:hidden">
              Add optional details <span className="text-lg transition-transform group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <div className="grid gap-3 pb-2 pt-1 sm:grid-cols-2">
              <label className="block text-xs font-bold uppercase tracking-wide" htmlFor="signup-first-name">First name <span className="font-normal normal-case text-neutral-300">optional</span>
                <input id="signup-first-name" data-testid="input-signup-first-name" className={fieldClass} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide" htmlFor="signup-last-name">Last name <span className="font-normal normal-case text-neutral-300">optional</span>
                <input id="signup-last-name" data-testid="input-signup-last-name" className={fieldClass} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide sm:col-span-2" htmlFor="signup-dob">Date of birth <span className="font-normal normal-case text-neutral-300">optional</span>
                <input id="signup-dob" data-testid="input-signup-dob" className={fieldClass} type="date" max={today} autoComplete="bday" value={dob} onChange={(e) => { setDob(e.target.value); setErrors((old) => ({ ...old, dob: '' })); }} aria-invalid={!!errors.dob} aria-describedby={errors.dob ? 'signup-dob-error' : undefined} />
                {errors.dob && <span id="signup-dob-error" className="mt-1 block text-xs font-semibold text-red-300">{errors.dob}</span>}
              </label>
            </div>
          </details>

          <fieldset className="space-y-2 pt-1">
            <legend className="mb-2 text-xs font-extrabold uppercase tracking-wide">Your choices — both optional</legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-relaxed">
              <input data-testid="checkbox-email-marketing" className="mt-0.5 h-5 w-5 shrink-0 accent-white" type="checkbox" checked={emailOptIn} onChange={(e) => setEmailOptIn(e.target.checked)} />
              <span>Yes, email me Curvy Rails news, launches and updates. This is optional and separate from joining.</span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-relaxed">
              <input data-testid="checkbox-sms-marketing" className="mt-0.5 h-5 w-5 shrink-0 accent-white" type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} />
              <span>Yes, text me Curvy Rails news and updates. This is optional and separate from joining.</span>
            </label>
          </fieldset>

          {hasErrors && <p role="alert" aria-live="assertive" className="border-l-2 border-red-300 pl-3 text-sm font-semibold text-red-200">Please check the highlighted details above.</p>}
          {saveError && <p role="alert" aria-live="assertive" className="border-l-2 border-red-300 pl-3 text-sm font-semibold text-red-200">{saveError}</p>}
          <button data-testid="button-submit-signup" type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 bg-[#f5f2eb] px-5 text-xs font-extrabold uppercase tracking-[.12em] text-black transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Join The Rails (preview) <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <p className="text-[10px] leading-relaxed text-neutral-300">
            Demo only: your details and choices are saved in this browser, not sent to us. No real subscription, discount or account is created; no email or SMS is sent. Read our <Link href="/privacy" className="font-bold text-white underline underline-offset-2">privacy policy</Link> and <Link href="/terms" className="font-bold text-white underline underline-offset-2">terms</Link>.
          </p>
        </form>
      </div>
    </div>
  );
}

function RewardsContents({ onJoin }: { onJoin: () => void }) {
  const rows = [
    ['Collect points', 'How purchases, including purchases made through other channels, may count.', 'Rate and eligible channels: To be confirmed.'],
    ['Points are pending', 'A new purchase may first appear as pending while an order is being completed.', 'Approval and waiting period: To be confirmed.'],
    ['Points are approved', 'Once approved, points may become available to use in a future rewards programme.', 'Approval conditions: To be confirmed.'],
    ['Use rewards', 'Future rewards could include treats or early access for the community.', 'Point values, voucher values and redemption rules: To be confirmed.'],
  ];
  return (
    <div className="p-6 sm:p-10">
      <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.2em]"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> The Rails · concept</div>
      <DialogTitle className="font-display mt-4 max-w-xl text-4xl uppercase leading-[.92] sm:text-6xl">Collect points.<br />Earn rewards.</DialogTitle>
      <DialogDescription id="rewards-dialog-description" className="mt-4 max-w-xl text-sm leading-relaxed text-neutral-700">
        A preview of how The Rails could work. No account, balance, points or redemption exists in this demo, and no rates or reward values have been set.
      </DialogDescription>
      <ol className="mt-7 border-y border-black">
        {rows.map(([title, body, rule], index) => (
          <li key={title} className="grid gap-2 border-b border-black/20 py-4 last:border-b-0 sm:grid-cols-[2.5rem_1fr]">
            <span className="font-display text-2xl" aria-hidden="true">0{index + 1}</span>
            <div><h3 className="text-sm font-extrabold uppercase tracking-wide">{title}</h3><p className="mt-1 text-sm leading-relaxed text-neutral-700">{body}</p><p className="mt-2 text-[11px] font-bold uppercase tracking-wide">{rule}</p></div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" data-testid="button-join-from-rewards" onClick={onJoin} className="inline-flex min-h-12 items-center justify-center gap-2 bg-black px-6 text-xs font-extrabold uppercase tracking-widest text-white">Join The Rails (preview) <ArrowRight className="h-4 w-4" /></button>
        <p className="text-xs text-neutral-600">Points and all programme rules are still to be confirmed.</p>
      </div>
    </div>
  );
}
