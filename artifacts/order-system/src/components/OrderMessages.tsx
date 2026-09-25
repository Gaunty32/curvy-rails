import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";

function getStoredActor(): string {
  return localStorage.getItem("sbs_actor_name") || "";
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = getStoredActor();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { "x-actor": actor } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface OrderMessage {
  id: number;
  orderId: number;
  orderNumber: string;
  authorName: string;
  body: string;
  createdAt: string;
}

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  if (hrs < 48) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

const AVATAR_COLOURS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
];

function avatarColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLOURS[Math.abs(h) % AVATAR_COLOURS.length];
}

export function OrderMessages({ orderId }: { orderId: number }) {
  const actor = getStoredActor();
  const [draft, setDraft] = useState("");
  const [authorName, setAuthorName] = useState(actor || "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: messages = [], isLoading } = useQuery<OrderMessage[]>({
    queryKey: ["order-messages", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/messages`),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const postMutation = useMutation({
    mutationFn: () => apiFetch(`/orders/${orderId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: draft.trim(), authorName: authorName.trim() || "Unknown" }),
    }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["order-messages", orderId] });
      qc.invalidateQueries({ queryKey: ["messages-inbox"] });
    },
    onError: (e: Error) => toast({ title: "Failed to send message", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (!authorName.trim()) return;
    postMutation.mutate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (draft.trim() && authorName.trim()) postMutation.mutate();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[340px]">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2 pr-1 max-h-[420px]">
        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
            <MessageSquare className="w-10 h-10 opacity-20" />
            <p className="text-sm">No messages yet — start the conversation below.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.authorName === authorName;
            return (
              <div key={msg.id} className={cn("flex gap-3", isMe && "flex-row-reverse")}>
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5",
                  avatarColour(msg.authorName)
                )}>
                  {getInitials(msg.authorName)}
                </div>
                <div className={cn("flex flex-col gap-1 max-w-[80%]", isMe && "items-end")}>
                  <div className={cn(
                    "flex items-baseline gap-2",
                    isMe && "flex-row-reverse"
                  )}>
                    <span className="text-xs font-semibold text-foreground">{msg.authorName}</span>
                    <span className="text-[10px] text-muted-foreground">{formatMsgTime(msg.createdAt)}</span>
                  </div>
                  <div className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                    isMe
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted text-foreground rounded-tl-sm"
                  )}>
                    {msg.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="pt-4 border-t border-border/50 space-y-3">
        {!actor && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Your name</label>
            <input
              type="text"
              className="flex-1 text-sm border border-border rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary/40 bg-background"
              placeholder="Enter your name..."
              value={authorName}
              onChange={e => setAuthorName(e.target.value)}
            />
          </div>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            placeholder="Type a message… (Ctrl+Enter to send)"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            className="flex-1 resize-none text-sm"
          />
          <Button
            type="submit"
            size="sm"
            className="h-[60px] px-3.5"
            disabled={!draft.trim() || !authorName.trim() || postMutation.isPending}
          >
            {postMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Messages are internal only — not visible to customers. Ctrl+Enter to send.
        </p>
      </form>
    </div>
  );
}
