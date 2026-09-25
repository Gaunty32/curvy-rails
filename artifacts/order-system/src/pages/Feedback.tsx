import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout, { FeedbackDialog } from "@/components/Layout";
import { KitDesignerText } from "@/components/KitDesignerText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, AlertCircle, Lightbulb, Clock, CheckCircle2, Loader2, User, Monitor, MessageSquare, Save, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = localStorage.getItem("sbs_actor_name") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(actor ? { "x-actor": actor } : {}), ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface FeedbackItem {
  id: number;
  type: "critical" | "minor" | "feature";
  title: string;
  description: string;
  submitted_by: string;
  source: "staff" | "portal";
  status: "open" | "in_progress" | "resolved";
  admin_note: string;
  note_by: string | null;
  note_at: string | null;
  created_at: string;
}

const TYPE_CONFIG = {
  critical: { label: "Critical Issue", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-700" },
  minor:    { label: "Minor Issue",    icon: AlertCircle,   color: "text-amber-600", bg: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700" },
  feature:  { label: "Feature Request",icon: Lightbulb,     color: "text-blue-600", bg: "bg-blue-50 border-blue-200",   badge: "bg-blue-100 text-blue-700" },
};

const STATUS_CONFIG = {
  open:        { label: "Open",        icon: Clock,         color: "text-slate-600",  badge: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In Progress", icon: Loader2,       color: "text-purple-600", badge: "bg-purple-100 text-purple-700" },
  resolved:    { label: "Resolved",    icon: CheckCircle2,  color: "text-green-600",  badge: "bg-green-100 text-green-700" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Individual feedback card ─────────────────────────────────────────────────
function FeedbackCard({ item }: { item: FeedbackItem }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.admin_note ?? "");

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/feedback/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  });

  const saveNote = useMutation({
    mutationFn: () => {
      const actor = localStorage.getItem("sbs_actor_name") || "";
      return apiFetch(`/feedback/${item.id}`, { method: "PATCH", body: JSON.stringify({ admin_note: noteDraft, note_by: actor }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  });

  const typeCfg = TYPE_CONFIG[item.type];
  const statusCfg = STATUS_CONFIG[item.status];
  const TypeIcon = typeCfg.icon;
  const hasNote = !!item.admin_note;

  return (
    <div className={cn("rounded-xl border bg-card transition-all", item.status === "resolved" && "opacity-60")}>
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        <div className={cn("mt-0.5 shrink-0", typeCfg.color)}>
          <TypeIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", typeCfg.badge)}>
              {typeCfg.label}
            </span>
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", statusCfg.badge)}>
              {statusCfg.label}
            </span>
            {/* Source + submitter */}
            <span className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              item.source === "portal"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-100 text-slate-600"
            )}>
              {item.source === "portal" ? <Monitor className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {item.submitted_by
                ? item.submitted_by
                : item.source === "portal" ? "Customer Portal" : "Staff"}
            </span>
          </div>

          {/* Title + description */}
          <p className="font-semibold text-foreground leading-tight">{item.title}</p>
          {item.description && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap"><KitDesignerText>{item.description}</KitDesignerText></p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{fmtDate(item.created_at)}</span>
            {hasNote && !noteOpen && (
              <span className="flex items-center gap-1 text-blue-600 font-medium">
                <MessageSquare className="w-3 h-3" /> Note added
              </span>
            )}
          </div>

          {/* Existing note (collapsed preview) */}
          {hasNote && !noteOpen && (
            <div className="mt-2 text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="font-semibold text-blue-700">Note</span>
                {item.note_by && (
                  <span className="text-blue-500">by {item.note_by}</span>
                )}
                {item.note_at && (
                  <span className="text-blue-400">· {fmtDate(item.note_at)}</span>
                )}
              </div>
              <p className="line-clamp-2">{item.admin_note}</p>
            </div>
          )}

          {/* Inline note editor */}
          {noteOpen && (
            <div className="mt-3 space-y-2">
              <Textarea
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                placeholder="Add a note for the person who submitted this…"
                rows={3}
                className="text-sm"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => saveNote.mutate()}
                  disabled={saveNote.isPending || noteDraft === (item.admin_note ?? "")}
                >
                  {saveNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save note
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => { setNoteOpen(false); setNoteDraft(item.admin_note ?? ""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right controls */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <Select
            value={item.status}
            onValueChange={status => updateStatus.mutate(status)}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant={noteOpen ? "secondary" : "outline"}
            className="h-7 text-xs gap-1.5 w-36"
            onClick={() => setNoteOpen(o => !o)}
          >
            <MessageSquare className="w-3 h-3" />
            {noteOpen ? "Close note" : hasNote ? "Edit note" : "Add note"}
            {noteOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Feedback() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [raiseIssueOpen, setRaiseIssueOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery<FeedbackItem[]>({
    queryKey: ["feedback"],
    queryFn: () => apiFetch("/feedback"),
  });

  const filtered = items.filter(item => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    return true;
  });

  const counts = {
    critical: items.filter(i => i.type === "critical" && i.status !== "resolved").length,
    minor:    items.filter(i => i.type === "minor"    && i.status !== "resolved").length,
    feature:  items.filter(i => i.type === "feature"  && i.status !== "resolved").length,
  };

  return (
    <Layout>
      <div className="space-y-6">
        <FeedbackDialog open={raiseIssueOpen} onClose={() => setRaiseIssueOpen(false)} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Feedback & Issues</h1>
            <p className="text-sm text-muted-foreground mt-1">Issues and feature requests submitted by staff and portal customers.</p>
          </div>
          <Button onClick={() => setRaiseIssueOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            Raise new issue
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {(["critical", "minor", "feature"] as const).map(type => {
            const cfg = TYPE_CONFIG[type];
            const Icon = cfg.icon;
            return (
              <button
                key={type}
                onClick={() => { setTypeFilter(type); setStatusFilter("all"); }}
                className={cn(
                  "p-4 rounded-xl border text-left transition-all hover:shadow-sm",
                  cfg.bg,
                  typeFilter === type ? "ring-2 ring-offset-1 ring-current" : ""
                )}
              >
                <div className={cn("flex items-center gap-2 mb-1", cfg.color)}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
                </div>
                <p className={cn("text-2xl font-bold", cfg.color)}>{counts[type]}</p>
                <p className="text-xs text-muted-foreground">open</p>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="critical">Critical Issues</SelectItem>
              <SelectItem value="minor">Minor Issues</SelectItem>
              <SelectItem value="feature">Feature Requests</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Items list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Nothing here</p>
            <p className="text-sm">No items match the current filters.</p>
            <Button className="mt-5 gap-2" onClick={() => setRaiseIssueOpen(true)}>
              <Plus className="w-4 h-4" />
              Raise new issue
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => <FeedbackCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </Layout>
  );
}
