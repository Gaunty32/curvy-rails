import { useEffect } from 'react';
export function usePageHead(title: string, description: string) {
  useEffect(() => {
    document.title = `${title} | Curvy Rails (demo)`;
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); }
    m.setAttribute('content', description);
    window.scrollTo(0, 0);
  }, [title, description]);
}
