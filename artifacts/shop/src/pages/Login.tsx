import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useShopAuth } from '@/context/ShopAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Step = 'email' | 'code';

export default function Login() {
  const { isLoggedIn, login } = useShopAuth();
  const [, setLocation] = useLocation();
  const requestedReturnTo = new URLSearchParams(window.location.search).get('returnTo');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/account';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) setLocation(returnTo);
  }, [isLoggedIn, returnTo, setLocation]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/shop/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code');
      setStep('code');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/shop/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      login(data.token, data.customer);
      setLocation(returnTo);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/shop/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend');
      setResendCooldown(60);
      setCode('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-primary mb-2">
          {step === 'email' ? 'Sign in to your account' : 'Check your email'}
        </h1>
        <p className="text-gray-600 mb-8">
          {step === 'email'
            ? "Ordered from us before? Enter the email address from your old WooCommerce login so we can link you to your existing account and order history. We'll send a one-time code — no old password needed."
            : `We sent a 6-digit code to ${email}. Enter it below to sign in.`}
        </p>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Email address
              </label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                className="rounded-none"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="rounded-none font-bold"
              disabled={loading}
            >
              {loading ? 'SENDING…' : 'SEND LOGIN CODE'}
            </Button>
            <p className="text-xs text-gray-500 text-center mt-2">
              New customer? We will create your account automatically on first sign-in.
            </p>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                6-digit code
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
                className="rounded-none text-center text-2xl tracking-widest font-bold"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="rounded-none font-bold"
              disabled={loading || code.length < 6}
            >
              {loading ? 'VERIFYING…' : 'SIGN IN'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="text-gray-500 hover:text-gray-700 underline"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={resend}
                disabled={resendCooldown > 0 || loading}
                className="text-primary hover:text-primary/80 underline disabled:text-gray-400 disabled:no-underline"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
