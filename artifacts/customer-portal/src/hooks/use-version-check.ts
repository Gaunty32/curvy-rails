import { useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

async function fetchVersionHash(): Promise<string | null> {
  try {
    const url = (import.meta.env.BASE_URL ?? "/") + "?_v=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    // Vite embeds content-hashed asset filenames in the HTML, e.g. /assets/index-BcD1a2b3.js
    const match = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const knownVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const version = await fetchVersionHash();
      if (!version || cancelled) return;

      if (knownVersion.current === null) {
        knownVersion.current = version;
        return;
      }

      if (version !== knownVersion.current) {
        setUpdateAvailable(true);
      }
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return updateAvailable;
}
