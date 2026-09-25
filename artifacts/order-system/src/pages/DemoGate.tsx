import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDemoToken, setDemoSession } from "@/lib/demo";

const API_BASE = "/api";

const SHOTS = [
  "/demo-bg/dashboard.jpg",
  "/demo-bg/orders.jpg",
  "/demo-bg/products.jpg",
  "/demo-bg/wardrobe.png",
];

const COLUMNS: { imgs: string[]; duration: number }[] = [
  { imgs: [SHOTS[0], SHOTS[2], SHOTS[1], SHOTS[3]], duration: 32 },
  { imgs: [SHOTS[1], SHOTS[3], SHOTS[0], SHOTS[2]], duration: 24 },
  { imgs: [SHOTS[2], SHOTS[0], SHOTS[3], SHOTS[1]], duration: 28 },
];

function ScrollColumn({ imgs, duration }: { imgs: string[]; duration: number }) {
  const doubled = [...imgs, ...imgs];
  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        className="demo-scroll-col flex flex-col gap-3"
        style={{ animationDuration: `${duration}s` }}
      >
        {doubled.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="w-full rounded-xl shadow-lg border border-white/10 select-none"
          />
        ))}
      </div>
    </div>
  );
}

export default function DemoGate() {
  const [, setLocation] = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [company,   setCompany]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (getDemoToken()) setLocation("/demo/dashboard");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/demo/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDemoSession(data.token, { firstName: data.firstName, company: data.company });
      setLocation("/demo/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">

      {/* ── Left panel: form ── */}
      <div className="relative z-10 flex flex-col justify-center w-full md:w-[440px] shrink-0 px-8 py-10 bg-slate-950">

        {/* Brand */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Eye className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">Your business</span>
          </div>
          <p className="text-slate-500 text-sm">Effortless uniform management, from order to delivery</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-7 pt-7 pb-5 border-b border-slate-800">
            <h1 className="text-xl font-bold text-white mb-1">Interactive system demo</h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              Enter your details to get 48‑hour access to the live system with sample data.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-7 py-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-slate-300 text-sm">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Jane"
                  required
                  disabled={loading}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-slate-300 text-sm">Last name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Smith"
                  required
                  disabled={loading}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300 text-sm">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jane@yourcompany.com"
                required
                disabled={loading}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company" className="text-slate-300 text-sm">Company name</Label>
              <Input
                id="company"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Acme Ltd"
                required
                disabled={loading}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-base bg-blue-600 hover:bg-blue-500 text-white"
              disabled={loading}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Setting up your demo…</>
                : "Explore the system →"
              }
            </Button>

            <p className="text-xs text-center text-slate-500 pt-1">
              By continuing you agree to receive a follow-up email from our team. No spam, ever.
            </p>
          </form>
        </div>

        <p className="mt-6 text-slate-600 text-xs text-center leading-relaxed">
          Customer data is anonymised. Financial figures are illustrative only.
        </p>

        <p className="mt-4 text-center">
          <button
            onClick={() => setLocation("/login")}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2"
          >
            Staff login
          </button>
        </p>
      </div>

      {/* ── Right panel: scrolling screenshot mosaic ── */}
      <div className="hidden md:flex flex-1 overflow-hidden relative gap-3 p-4 bg-slate-900">
        {/* Fade edges top/bottom */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-900 to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent z-10" />
        {/* Fade left edge into form panel */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-slate-900 to-transparent z-10" />

        {COLUMNS.map((col, i) => (
          <ScrollColumn key={i} imgs={col.imgs} duration={col.duration} />
        ))}
      </div>
    </div>
  );
}
