import { useEffect, useState, useCallback, useRef } from "react";

const API_BASE = "/api";

// ── Config (override via URL params) ─────────────────────────────────────────
function getParam(key: string, fallback: number) {
  const v = new URLSearchParams(window.location.search).get(key);
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? fallback : n;
}

const PILLS_PER_PAGE = getParam("perPage", 8);   // pills per slide
const SLIDE_SECS     = getParam("secs",    12);  // seconds per slide

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlanFinish {
  finishName: string;
  qty: number;
  worksheetNumber: string | null;
  type: string;
}

interface PlanTaskGroup {
  finishName: string;
  customerName: string;
  finishes: PlanFinish[];
  totalQty: number;
  orderCount: number;
  overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
  earliestRequired: string | null;
}

interface DailyPlan {
  generatedAt: string;
  taskGroups: PlanTaskGroup[];
  summary: {
    overdue: number;
    today: number;
    soon: number;
    thisWeek: number;
    upcoming: number;
    urgentCount: number;
    urgentItems: number;
    totalItems: number;
  };
}

// ── Flatten task groups into individual pill items ────────────────────────────
interface PillItem {
  customerName: string;
  finishName: string;
  qty: number;
  worksheetNumber: string | null;
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
}

function flattenPills(groups: PlanTaskGroup[]): PillItem[] {
  const pills: PillItem[] = [];
  for (const g of groups) {
    for (const f of g.finishes ?? []) {
      pills.push({
        customerName: g.customerName,
        finishName: f.finishName,
        qty: f.qty,
        worksheetNumber: f.worksheetNumber,
        urgency: g.urgency,
        daysUntilDue: g.daysUntilDue,
      });
    }
  }
  return pills;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const STYLES = {
  overdue: {
    card:   "border-red-600 bg-red-950/70",
    dot:    "bg-red-500",
    badge:  "bg-red-900/80 text-red-200 border border-red-600",
    label:  "text-red-400",
    qty:    "text-red-300",
    tag:    "text-red-500",
    ws:     "text-red-400/70",
  },
  today: {
    card:   "border-orange-600 bg-orange-950/70",
    dot:    "bg-orange-500",
    badge:  "bg-orange-900/80 text-orange-200 border border-orange-600",
    label:  "text-orange-400",
    qty:    "text-orange-300",
    tag:    "text-orange-500",
    ws:     "text-orange-400/70",
  },
  soon: {
    card:   "border-amber-600/80 bg-amber-950/50",
    dot:    "bg-amber-400",
    badge:  "bg-amber-900/80 text-amber-200 border border-amber-600",
    label:  "text-amber-400",
    qty:    "text-amber-300",
    tag:    "text-amber-500",
    ws:     "text-amber-400/70",
  },
} as const;

type Variant = keyof typeof STYLES;

function urgencyVariant(u: string): Variant {
  if (u === "overdue") return "overdue";
  if (u === "today")   return "today";
  return "soon";
}

function urgencyLabel(u: string, days: number | null): string {
  if (u === "overdue") return days !== null ? `${Math.abs(days)}d OVERDUE` : "OVERDUE";
  if (u === "today")   return "DUE TODAY";
  if (u === "soon")    return "TOMORROW";
  return "UPCOMING";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ── Big Pill Card ─────────────────────────────────────────────────────────────
function PillCard({ pill }: { pill: PillItem }) {
  const v = urgencyVariant(pill.urgency);
  const s = STYLES[v];
  return (
    // min-w-0 + overflow-hidden prevent the grid-blowout where content forces
    // the cell wider than its 1fr share, pushing the last column off-screen.
    <div
      className={`rounded-3xl border-4 ${s.card} flex flex-col justify-between h-full min-w-0 overflow-hidden`}
      style={{ padding: "clamp(0.8rem, 1.6vw, 2rem)" }}
    >
      {/* Top row: urgency tag */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span
          className={`font-black uppercase tracking-widest truncate ${s.tag}`}
          style={{ fontSize: "clamp(0.6rem, 0.9vw, 1.05rem)" }}
        >
          {urgencyLabel(pill.urgency, pill.daysUntilDue)}
        </span>
        {pill.worksheetNumber && (
          <span
            className={`font-mono font-semibold shrink-0 ${s.ws}`}
            style={{ fontSize: "clamp(0.6rem, 0.85vw, 1rem)" }}
          >
            {pill.worksheetNumber}
          </span>
        )}
      </div>

      {/* Centre: finish name — the star of the show */}
      <div
        className="font-black text-white leading-tight break-words overflow-hidden flex-1 flex items-center py-1"
        style={{ fontSize: "clamp(1.1rem, 2.2vw, 3.2rem)", minHeight: 0 }}
      >
        {pill.finishName}
      </div>

      {/* Bottom row: customer + qty */}
      <div className="flex items-end justify-between gap-2 shrink-0 min-w-0">
        <span
          className={`font-semibold truncate min-w-0 ${s.label}`}
          style={{ fontSize: "clamp(0.75rem, 1.3vw, 1.8rem)" }}
        >
          {pill.customerName}
        </span>
        <span
          className={`font-black tabular-nums leading-none shrink-0 ${s.qty}`}
          style={{ fontSize: "clamp(1.8rem, 3.8vw, 5.5rem)" }}
        >
          {pill.qty}
        </span>
      </div>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ durationMs, running }: { durationMs: number; running: boolean }) {
  const [pct, setPct] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    setPct(0);
    startRef.current = Date.now();
    if (!running) return;
    const raf = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setPct(Math.min(100, (elapsed / durationMs) * 100));
    }, 100);
    return () => clearInterval(raf);
  }, [running, durationMs]);

  return (
    <div className="w-full h-1.5 bg-white/10 flex-shrink-0">
      <div
        className="h-full bg-blue-500/60 transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TvDisplay() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [plan, setPlan]               = useState<DailyPlan | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [pageIndex, setPageIndex]     = useState(0);
  const [now, setNow]                 = useState(new Date());
  const [progressKey, setProgressKey] = useState(0);

  // ── Fetch plan ──────────────────────────────────────────────────────────────
  const fetchPlan = useCallback(async () => {
    if (!token) { setError("No token in URL."); return; }
    try {
      const res = await fetch(`${API_BASE}/tv/daily-plan?token=${encodeURIComponent(token)}`);
      if (res.status === 401 || res.status === 403) { setError("Invalid or missing token."); return; }
      if (!res.ok) { setError("Failed to load plan."); return; }
      const data: DailyPlan = await res.json();
      setPlan(data);
      setError(null);
    } catch {
      setError("Network error — retrying.");
    }
  }, [token]);

  useEffect(() => {
    fetchPlan();
    const dataTimer  = setInterval(fetchPlan, 30_000);
    const clockTimer = setInterval(() => setNow(new Date()), 60_000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, [fetchPlan]);

  // ── Build pill list ──────────────────────────────────────────────────────────
  const urgentGroups = [
    ...(plan?.taskGroups.filter((g) => g.urgency === "overdue") ?? []),
    ...(plan?.taskGroups.filter((g) => g.urgency === "today")   ?? []),
    ...(plan?.taskGroups.filter((g) => g.urgency === "soon")    ?? []),
  ];
  const allPills   = flattenPills(urgentGroups);
  const pages      = allPills.length > 0 ? chunk(allPills, PILLS_PER_PAGE) : [];
  const totalPages = pages.length;

  // Auto-advance slides
  useEffect(() => {
    if (totalPages <= 1) return;
    const t = setInterval(() => {
      setPageIndex((i) => (i + 1) % totalPages);
      setProgressKey((k) => k + 1);
    }, SLIDE_SECS * 1000);
    return () => clearInterval(t);
  }, [totalPages]);

  // Reset to page 0 when plan refreshes
  useEffect(() => {
    setPageIndex(0);
    setProgressKey((k) => k + 1);
  }, [plan]);

  const currentPage = pages[pageIndex] ?? [];
  const urgentTotal = urgentGroups.length;
  const summary     = plan?.summary;

  // Grid: 4 cols × 2 rows = 8 pills per page
  const COLS = 4;

  return (
    <div
      className="flex flex-col text-white select-none"
      style={{
        position: "fixed", inset: 0, overflow: "hidden",
        background: "#0a0f1e", fontFamily: "'Segoe UI', Arial, sans-serif",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between border-b border-white/10 flex-shrink-0"
        style={{ padding: "clamp(0.5rem, 1vw, 1.2rem) clamp(1rem, 2vw, 2.5rem)" }}
      >
        <div className="flex items-center gap-4">
          <span className="font-black text-white" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
            ⚡ Production Plan
          </span>
          <span className="text-slate-500" style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.3rem)" }}>
            {formatDateLong(now)}
          </span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-medium" style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.3rem)" }}>
              {pageIndex + 1} / {totalPages}
            </span>
            <div className="flex gap-1.5">
              {pages.map((_, i) => (
                <span
                  key={i}
                  className={`rounded-full transition-colors ${i === pageIndex ? "bg-blue-400" : "bg-white/20"}`}
                  style={{ width: "clamp(6px, 0.6vw, 10px)", height: "clamp(6px, 0.6vw, 10px)" }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {plan && (
        <div
          className={`flex items-center flex-wrap gap-x-6 border-b border-white/10 flex-shrink-0 ${
            urgentTotal > 0 ? "bg-red-950/30" : "bg-green-950/20"
          }`}
          style={{ padding: "clamp(0.4rem, 0.8vw, 1rem) clamp(1rem, 2vw, 2.5rem)" }}
        >
          <span
            className={`font-black ${urgentTotal > 0 ? "text-red-400" : "text-green-400"}`}
            style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.7rem)" }}
          >
            {urgentTotal > 0
              ? `${urgentTotal} order${urgentTotal !== 1 ? "s" : ""} need attention`
              : "✓ All urgent work under control"}
          </span>
          <div className="flex items-center gap-6 ml-auto flex-wrap">
            {(summary?.overdue  ?? 0) > 0 && <span className="text-red-400    font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.overdue} overdue</span>}
            {(summary?.today    ?? 0) > 0 && <span className="text-orange-400 font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.today} today</span>}
            {(summary?.soon     ?? 0) > 0 && <span className="text-amber-400  font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.soon} tomorrow</span>}
            {(summary?.thisWeek ?? 0) > 0 && <span className="text-blue-400"             style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.thisWeek} this week</span>}
          </div>
        </div>
      )}

      {/* ── Pills grid ─────────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-hidden"
        style={{ padding: "clamp(0.75rem, 1.5vw, 2rem) clamp(1rem, 2vw, 2.5rem)" }}
      >
        {error && (
          <div
            className="flex items-center justify-center h-full rounded-2xl bg-red-950/60 border-2 border-red-700 text-red-300 font-bold"
            style={{ fontSize: "clamp(1rem, 1.8vw, 2rem)" }}
          >
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="flex items-center justify-center h-full text-slate-500" style={{ fontSize: "clamp(1rem, 2vw, 2.5rem)" }}>
            Loading…
          </div>
        )}

        {plan && urgentTotal === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div style={{ fontSize: "clamp(4rem, 10vw, 12rem)" }}>✅</div>
            <div className="font-black text-green-400" style={{ fontSize: "clamp(1.5rem, 3vw, 4rem)" }}>
              All urgent work is complete
            </div>
            {((summary?.thisWeek ?? 0) + (summary?.upcoming ?? 0)) > 0 && (
              <div className="text-slate-400" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
                {(summary!.thisWeek + summary!.upcoming)} further order{(summary!.thisWeek + summary!.upcoming) !== 1 ? "s" : ""} later this week
              </div>
            )}
          </div>
        )}

        {plan && currentPage.length > 0 && (
          <div
            className="h-full"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gridAutoRows: "1fr",
              gap: "clamp(0.6rem, 1.2vw, 1.8rem)",
            }}
          >
            {currentPage.map((pill, i) => (
              <PillCard key={`${pill.customerName}-${pill.finishName}-${i}`} pill={pill} />
            ))}
          </div>
        )}
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <ProgressBar
        key={progressKey}
        durationMs={SLIDE_SECS * 1000}
        running={totalPages > 1}
      />
    </div>
  );
}
