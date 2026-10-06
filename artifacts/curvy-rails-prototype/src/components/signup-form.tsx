import { ArrowRight } from 'lucide-react';
import { useSignupModal } from '@/components/signup-modal';

export function SignupForm() {
  const { openSignup } = useSignupModal();
  return (
    <button data-testid="button-signup" type="button" onClick={openSignup} className="inline-flex min-h-12 w-full max-w-md items-center justify-center gap-2 bg-black px-6 text-sm font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto">
      Join The Rails <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
