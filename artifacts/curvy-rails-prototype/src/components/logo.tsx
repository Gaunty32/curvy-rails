import { asset } from '@/data/catalogue';
export function Logo({ light = false, className = 'h-12' }: { light?: boolean; className?: string }) {
  return (
    <img src={asset('assets/logo.png')} alt="Curvy Rails, plus sizes 16-32" className={`${className} w-auto ${light ? 'invert' : 'mix-blend-multiply'}`} />
  );
}
