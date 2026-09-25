import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import Layout from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquarePlus, Search, ExternalLink, Phone, Mail, Package, User, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface WcEnquiry {
  id: number;
  product_id: number | null;
  product_name: string | null;
  customer_name: string;
  email: string;
  phone: string | null;
  message: string;
  customer_id: number | null;
  linked_customer_name: string | null;
  source: "product_page" | "chat" | null;
  created_at: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EnquiryCard({ item }: { item: WcEnquiry }) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();

  function handleCreateQuote() {
    const params = new URLSearchParams();
    params.set("wc_enquiry_id", String(item.id));
    params.set("name", item.customer_name);
    params.set("email", item.email);
    if (item.product_name) params.set("product", item.product_name);
    setLocation(`/quotes?${params.toString()}`);
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
            {item.customer_name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{item.customer_name}</span>
              {item.customer_id && (
                <Link href={`/customers/${item.customer_id}`}>
                  <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-primary/5 gap-1">
                    <User className="w-2.5 h-2.5" />
                    {item.linked_customer_name ?? "Linked customer"}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </Badge>
                </Link>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {item.source === "chat" ? "Send a message" : "Website form"}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <a
                href={`mailto:${item.email}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Mail className="w-3 h-3" />
                {item.email}
              </a>
              {item.phone && (
                <a
                  href={`tel:${item.phone}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  {item.phone}
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">{fmtDate(item.created_at)}</span>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={handleCreateQuote}>
            <FileText className="w-3 h-3" />
            Create Quote
          </Button>
        </div>
      </div>

      {item.product_name && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">Product:</span>
          <span>{item.product_name}</span>
        </div>
      )}

      <div>
        <p
          className={cn(
            "text-sm text-foreground leading-relaxed",
            !expanded && "line-clamp-3"
          )}
        >
          {item.message}
        </p>
        {item.message.length > 200 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary hover:underline mt-1"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Enquiries() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery<WcEnquiry[]>({
    queryKey: ["wc-enquiries"],
    queryFn: () => apiFetch("/wc-enquiries"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const enquiries = data ?? [];

  const filtered = enquiries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.customer_name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.phone ?? "").toLowerCase().includes(q) ||
      (e.product_name ?? "").toLowerCase().includes(q) ||
      e.message.toLowerCase().includes(q)
    );
  });

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <MessageSquarePlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Web Enquiries</h1>
              <p className="text-sm text-muted-foreground">
                Messages submitted through the configured shop
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "enquiry" : "enquiries"}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, product or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Content */}
        {isLoading && (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading enquiries…</div>
        )}

        {isError && (
          <div className="text-center py-16 text-destructive text-sm">Failed to load enquiries.</div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <MessageSquarePlus className="w-10 h-10 mx-auto opacity-20" />
            <p className="font-medium">
              {search ? "No enquiries match your search" : "No enquiries yet"}
            </p>
            {!search && (
              <p className="text-xs max-w-sm mx-auto">
                Messages submitted through the website will appear here automatically.
              </p>
            )}
          </div>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((e) => (
              <EnquiryCard key={e.id} item={e} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
