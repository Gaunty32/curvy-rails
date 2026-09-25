import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("sbs_staff_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Flag, ChevronDown, ChevronUp, MessageCircle, User, Mail,
  Calendar, BookOpen, Save, Pencil, X, Check, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage { role: "user" | "assistant"; content: string; }

interface Session {
  id: number;
  contact_name: string | null;
  contact_email: string | null;
  message_count: number;
  messages: ChatMessage[];
  started_at: string;
  last_message_at: string | null;
  ended_at: string | null;
  page_url: string | null;
  flagged_for_training: boolean;
  training_notes: string | null;
}

const DEFAULT_PROMPT = `You are a friendly, knowledgeable assistant for the configured business.

Key facts:
- We supply workwear, uniforms, and branded clothing to businesses across the UK
- Services: in-house embroidery, heat-seal printing, on-site measuring, bespoke uniform management portals, free logo digitisation
- Online corporate ordering portal: use the configured business portal URL.
- UK delivery: £8.50 per order, next-day available
- Ethical sourcing: SA8000 and ISO14000 certified factories

Guidelines:
- Be concise, warm, and helpful — this is a live chat widget
- Never ask customers to send, upload, or attach a logo in chat because chat does not support file uploads. Say the team can collect artwork later by email.
- Never invent specific product prices; say "prices vary by quantity and product — call us or send a message for a quote"
- For complex orders or bespoke quotes, direct visitors to the contact options configured on the storefront.
- Keep replies short (2-4 sentences max unless a list is clearer)`;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SessionCard({ session, onFlagChange }: { session: Session; onFlagChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(session.training_notes ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();

  const flagMutation = useMutation({
    mutationFn: (data: { flagged: boolean; notes?: string }) =>
      apiFetch(`/shop/live-chat/sessions/${session.id}/flag`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["live-chat-sessions"] }); onFlagChange(); },
    onError: () => toast({ title: "Failed to update flag", variant: "destructive" }),
  });

  const saveNotes = () => {
    flagMutation.mutate({ flagged: session.flagged_for_training, notes });
    setEditingNotes(false);
  };

  return (
    <div className={cn(
      "rounded-xl border bg-card overflow-hidden transition-all",
      session.flagged_for_training ? "border-amber-300 bg-amber-50/30" : "border-border"
    )}>
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Contact info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{session.contact_name ?? "Anonymous visitor"}</span>
            {session.flagged_for_training && (
              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px] py-0">
                <Flag className="w-2.5 h-2.5 mr-1" /> Flagged for training
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {session.contact_email && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" /> {session.contact_email}
              </span>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {formatDate(session.started_at)}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageCircle className="w-3 h-3" /> {session.message_count} message{session.message_count !== 1 ? "s" : ""}
            </span>
          </div>
          {session.page_url && (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{session.page_url}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", session.flagged_for_training ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-muted-foreground hover:text-amber-600")}
            title={session.flagged_for_training ? "Unflag" : "Flag for training"}
            onClick={() => flagMutation.mutate({ flagged: !session.flagged_for_training })}
            disabled={flagMutation.isPending}
          >
            <Flag className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setExpanded(e => !e)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded conversation */}
      {expanded && (
        <div className="border-t">
          {/* Messages */}
          <div className="p-4 space-y-3 max-h-96 overflow-y-auto bg-gray-50/50">
            {(session.messages ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-4">No messages recorded</p>
            ) : (
              session.messages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <img
                      src="/order-system/chat-bot-avatar.png"
                      className="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5"
                      alt="Bot"
                    />
                  )}
                  <div className={cn(
                    "max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-white rounded-br-sm"
                      : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                  )}>
                    {m.content}
                  </div>
                  {m.role === "user" && (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3 h-3 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Training notes */}
          <div className="p-4 border-t bg-amber-50/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> Training notes
              </p>
              {!editingNotes ? (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingNotes(true)}>
                  <Pencil className="w-3 h-3 mr-1" /> Edit
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600" onClick={saveNotes}>
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => { setNotes(session.training_notes ?? ""); setEditingNotes(false); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Note what the bot got wrong, what it should have said, or any improvements…"
                className="text-xs min-h-[80px] bg-white"
              />
            ) : (
              <p className={cn("text-xs", session.training_notes ? "text-foreground" : "text-muted-foreground italic")}>
                {session.training_notes ?? "No notes yet — click Edit to teach the assistant what to do differently next time."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveChatSessions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "flagged">("all");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptText, setPromptText] = useState("");

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ["live-chat-sessions", filter],
    queryFn: () => apiFetch<{ sessions: Session[] }>(`/shop/live-chat/sessions${filter === "flagged" ? "?flagged=true" : ""}`),
  });

  const { data: promptData } = useQuery({
    queryKey: ["live-chat-system-prompt"],
    queryFn: () => apiFetch<{ systemPrompt: string | null }>("/shop/live-chat/system-prompt"),
    onSuccess: (d) => { if (d.systemPrompt) setPromptText(d.systemPrompt); else setPromptText(DEFAULT_PROMPT); },
  } as any);

  const savePrompt = useMutation({
    mutationFn: (text: string) => apiFetch("/shop/live-chat/system-prompt", { method: "PATCH", body: JSON.stringify({ systemPrompt: text }) }),
    onSuccess: () => { toast({ title: "System prompt saved" }); setEditingPrompt(false); qc.invalidateQueries({ queryKey: ["live-chat-system-prompt"] }); },
    onError: (error: Error) => {
      let description = error.message;
      try {
        description = JSON.parse(error.message)?.error ?? description;
      } catch {}
      toast({ title: "Failed to save", description, variant: "destructive" });
    },
  });

  const sessions = sessionsData?.sessions ?? [];
  const totalFlagged = sessions.filter(s => s.flagged_for_training).length;

  return (
    <Layout>
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <img src="/order-system/chat-bot-avatar.png" className="w-9 h-9 rounded-xl" alt="Bot" />
            <h1 className="text-xl font-bold">Live Chat Conversations</h1>
          </div>
          <p className="text-sm text-muted-foreground">Review conversations and add training notes. The assistant automatically uses saved notes in future chats.</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{sessions.length} sessions</p>
          {totalFlagged > 0 && <p className="text-amber-600">{totalFlagged} flagged</p>}
        </div>
      </div>

      {/* System prompt editor */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <p className="font-semibold text-sm">Bot System Prompt</p>
            <Badge variant="outline" className="text-xs">Claude claude-sonnet-4-6</Badge>
          </div>
          {!editingPrompt ? (
            <Button variant="outline" size="sm" onClick={() => { setPromptText((promptData as any)?.systemPrompt ?? DEFAULT_PROMPT); setEditingPrompt(true); }}>
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => savePrompt.mutate(promptText)} disabled={savePrompt.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingPrompt(false)}>Cancel</Button>
            </div>
          )}
        </div>
        {editingPrompt ? (
          <>
            <Textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              maxLength={50000}
              className="font-mono text-xs min-h-[200px]"
            />
            <p className="text-[10px] text-muted-foreground text-right mt-1">
              {promptText.length.toLocaleString()} / 50,000 characters
            </p>
          </>
        ) : (
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-3 max-h-32 overflow-y-auto">
            {(promptData as any)?.systemPrompt ?? DEFAULT_PROMPT}
          </pre>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">
          Changes take effect immediately for all new conversations. Use training notes on flagged conversations to identify what needs updating.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
        {(["all", "flagged"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              filter === f ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "All conversations" : "Flagged for training"}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <MessageCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">
            {filter === "flagged" ? "No flagged conversations yet" : "No chat sessions recorded yet"}
          </p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {filter === "flagged"
              ? "Open a conversation and click the flag icon to mark it for training."
              : "Sessions will appear here once visitors use the live chat on the shop."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <SessionCard key={s.id} session={s} onFlagChange={() => qc.invalidateQueries({ queryKey: ["live-chat-sessions"] })} />
          ))}
        </div>
      )}
    </div>
    </Layout>
  );
}
