import { useEffect } from "react";
import { useLocation } from "wouter";
import { isStaffAuthenticated } from "@/lib/staff-auth";
import { ArrowRight, ShoppingBag, ClipboardList } from "lucide-react";
import IosInstallBanner from "@/components/IosInstallBanner";
import { businessDisplayName, useBusinessConfig } from "@/lib/business-config";

export default function Landing() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isStaffAuthenticated()) {
      setLocation("/dashboard");
    }
  }, []);

  const portalUrl = window.location.origin + "/customer-portal";
  const business = useBusinessConfig();
  const displayName = businessDisplayName(business);

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          {business.logoUrl && <img src={business.logoUrl} alt="" className="h-9 w-auto" />}
          <span className="text-white font-semibold text-lg tracking-tight">{displayName}</span>
        </div>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
        <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-3">Wardrobe Portal</p>
        <h1 className="text-white text-4xl sm:text-5xl font-bold leading-tight mb-4 max-w-xl">
          How can we help you today?
        </h1>
        <p className="text-slate-400 text-lg mb-12 max-w-md">
          Choose where you'd like to go.
        </p>

        <div className="grid sm:grid-cols-2 gap-5 w-full max-w-2xl">
          {/* Customer Portal card */}
          <a
            href={portalUrl}
            className="group relative flex flex-col items-start gap-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-sky-500/50 transition-all duration-200 p-7 text-left cursor-pointer"
          >
            <div className="rounded-xl bg-sky-500/20 p-3">
              <ShoppingBag className="w-6 h-6 text-sky-400" />
            </div>
            <div>
              <h2 className="text-white text-xl font-semibold mb-1">Customer Portal</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                Browse your approved workwear catalogue, place orders, and track your team's wardrobe.
              </p>
            </div>
            <span className="mt-auto flex items-center gap-1.5 text-sky-400 text-sm font-medium group-hover:gap-2.5 transition-all">
              Sign in to your portal <ArrowRight className="w-4 h-4" />
            </span>
          </a>

          {/* Staff card */}
          <button
            onClick={() => setLocation("/login")}
            className="group relative flex flex-col items-start gap-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-indigo-500/50 transition-all duration-200 p-7 text-left cursor-pointer w-full"
          >
            <div className="rounded-xl bg-indigo-500/20 p-3">
              <ClipboardList className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-white text-xl font-semibold mb-1">Staff Order System</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                Manage orders, customers, stock, production, and dispatch for your business.
              </p>
            </div>
            <span className="mt-auto flex items-center gap-1.5 text-indigo-400 text-sm font-medium group-hover:gap-2.5 transition-all">
              Staff login <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      </div>

      <footer className="text-center py-6 text-slate-600 text-xs">
        &copy; {new Date().getFullYear()} {displayName}
      </footer>

      <IosInstallBanner />
    </div>
  );
}
