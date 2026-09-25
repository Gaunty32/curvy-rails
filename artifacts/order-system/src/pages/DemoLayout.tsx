import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ClipboardList, LogOut, PhoneCall, Eye,
  Users, Package, Warehouse, Boxes, ListChecks, ShoppingBag,
  Send, FileText, Truck, CheckSquare, ExternalLink, ChevronDown,
} from "lucide-react";
import { getDemoUser, clearDemoSession } from "@/lib/demo";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "",
    items: [
      { label: "Dashboard",  href: "/demo/dashboard", icon: LayoutDashboard },
      { label: "Orders",     href: "/demo/orders",    icon: ClipboardList },
      { label: "Customers",  href: "/demo/customers", icon: Users },
      { label: "Products",   href: "/demo/products",  icon: Package },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Stock",          href: "/demo/stock",          icon: Warehouse  },
      { label: "Process Stock",  href: "/demo/process-stock",  icon: Boxes      },
      { label: "Production",     href: "/demo/production",     icon: ListChecks },
      { label: "Purchasing",     href: "/demo/purchasing",     icon: ShoppingBag},
      { label: "Dispatch",       href: "/demo/dispatch",       icon: Send       },
      { label: "Invoicing",      href: "/demo/invoicing",      icon: FileText   },
      { label: "Suppliers",      href: "/demo/suppliers",      icon: Truck      },
      { label: "Tasks",          href: "/demo/tasks",          icon: CheckSquare},
    ],
  },
  {
    label: "Portal",
    items: [
      { label: "Customer Portal", href: "/demo/portal", icon: ExternalLink },
    ],
  },
];

export default function DemoLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const user = getDemoUser();

  function handleExit() {
    clearDemoSession();
    setLocation("/demo");
  }

  return (
    <div className="flex min-h-screen bg-background">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-slate-900 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-700/60">
          <p className="text-sm font-bold text-white leading-tight">Your business</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Order Management System</p>
        </div>

        {/* Demo badge */}
        <div className="mx-4 mt-4 mb-1 flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 px-3 py-2">
          <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">Demo mode</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 pt-2 pb-4 space-y-3 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label || "__top__"}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 select-none">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map(({ label, href, icon: Icon }) => {
                  const active = location === href || location.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-white/10 text-white"
                          : "text-slate-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Book a call CTA + exit */}
        <div className="px-3 pb-4 border-t border-slate-700/60 pt-3 space-y-1">
          <a
            href="mailto:"
            className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2.5 text-sm font-medium text-white transition-colors"
          >
            <PhoneCall className="w-4 h-4 shrink-0" />
            Get in touch
          </a>
          <button
            onClick={handleExit}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Exit demo
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="border-b bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 border border-amber-200">
              <Eye className="w-3 h-3" /> Demo — data is anonymised
            </span>
          </div>
          {user && (
            <p className="text-sm text-muted-foreground">
              Viewing as <span className="font-medium text-foreground">{user.firstName}</span> · {user.company}
            </p>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
