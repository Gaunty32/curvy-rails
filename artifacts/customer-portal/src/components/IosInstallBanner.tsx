import { useState, useEffect } from "react";
import { X, Share, Plus, ExternalLink } from "lucide-react";

type BannerMode = "open-in-safari" | "add-to-homescreen" | null;

function detectMode(): BannerMode {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return null;

  // Already installed as a PWA — nothing to show
  const isStandalone =
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) return null;

  // In-app browser detection
  const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter|Snapchat|Line\/|GSA\/|MicroMessenger/i.test(ua);
  const hasSafariToken = /safari/i.test(ua);
  const isChromeiOS = /CriOS/i.test(ua);
  const isFirefoxiOS = /FxiOS/i.test(ua);

  if (isInAppBrowser || (!hasSafariToken && !isChromeiOS && !isFirefoxiOS)) {
    return "open-in-safari";
  }

  if (hasSafariToken && !isChromeiOS && !isFirefoxiOS) {
    return "add-to-homescreen";
  }

  return null;
}

const DISMISSED_KEY = "sbs_portal_install_banner_dismissed";

export default function IosInstallBanner() {
  const [mode, setMode] = useState<BannerMode>(null);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISSED_KEY)) return;
    setMode(detectMode());
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setMode(null);
  }

  if (!mode) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-6 pt-2 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-4">
        {mode === "open-in-safari" ? (
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
              <ExternalLink className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-semibold mb-0.5">Open in Safari</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                This page is running inside another app. For the best experience,{" "}
                <strong className="text-foreground">open this link in Safari</strong> — tap the{" "}
                <span className="inline-flex items-center gap-0.5 bg-muted rounded px-1 py-0.5">
                  <Share className="w-3 h-3" />
                </span>
                {" "}or <span className="bg-muted rounded px-1 py-0.5 text-xs">⋯</span>{" "}
                menu and choose <strong className="text-foreground">"Open in Safari"</strong>.
              </p>
            </div>
            <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-semibold mb-0.5">Install this app</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Tap{" "}
                <span className="inline-flex items-center gap-0.5 bg-muted rounded px-1 py-0.5">
                  <Share className="w-3 h-3" />
                </span>
                {" "}then{" "}
                <strong className="text-foreground">Add to Home Screen</strong>
                {" "}to install and open without the browser bar.
              </p>
            </div>
            <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-r border-b border-border bg-card" />
      </div>
    </div>
  );
}
