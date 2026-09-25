import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { useUpload } from "@workspace/object-storage-web";
import { 
  useListCustomers, 
  useCreateCustomer, 
  useUpdateCustomer, 
  useDeleteCustomer,
  getListCustomersQueryKey,
  Customer
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toTitleCase } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, Users, Loader2, Phone, LayoutGrid, List, Mail, Upload, X, Download, Building2, User, AlertTriangle, ShoppingCart, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";

// ── Duplicate-detection helpers ──────────────────────────────────────────────
const STRIP_WORDS = new Set(["ltd", "limited", "plc", "llp", "inc", "co", "company", "group", "the", "and", "uk", "solutions", "services", "trading"]);
function normaliseCustomerName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STRIP_WORDS.has(w));
}
function customerNameSimilarity(a: string, b: string): number {
  const ta = normaliseCustomerName(a);
  const tb = normaliseCustomerName(b);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = intersection / union;
  // Boost if one normalised string contains all tokens of the other
  const aStr = ta.join(" ");
  const bStr = tb.join(" ");
  const containsBoost = aStr.includes(bStr) || bStr.includes(aStr) ? 0.3 : 0;
  return Math.min(1, jaccard + containsBoost);
}

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface HlContact { id: string; name: string; company: string | null; email: string | null; phone: string | null; }

function ImportFromHlDialog({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (customerId: number) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HlContact[]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); }
  }, [open]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch<{ contacts: HlContact[] }>(
          `/enquiries/search?q=${encodeURIComponent(query)}`
        );
        setResults(data.contacts ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const handleImport = async (contact: HlContact) => {
    setImporting(contact.id);
    try {
      const res = await apiFetch<{ customerId: number; alreadyExisted: boolean }>(
        "/customers/import-from-hl",
        { method: "POST", body: JSON.stringify({ hlContactId: contact.id }) }
      );
      toast({
        title: res.alreadyExisted ? "Customer already exists" : "Customer imported",
        description: res.alreadyExisted
          ? `${contact.name} was already in your customer list — opening their record.`
          : `${contact.name} has been added as a customer.`,
      });
      onOpenChange(false);
      onImported(res.customerId);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            Import from High Level
          </DialogTitle>
          <DialogDescription>
            Search for a contact in High Level by name, company, or email and import them as a customer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search by name, company or email…"
              className="pl-9"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {results.length > 0 && (
            <div className="rounded-lg border divide-y max-h-72 overflow-y-auto">
              {results.map(contact => (
                <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{contact.name}</p>
                    {contact.company && contact.company !== contact.name && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <Building2 className="w-3 h-3 shrink-0" /> {contact.company}
                      </p>
                    )}
                    {contact.email && (
                      <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                    )}
                    {contact.phone && (
                      <p className="text-xs text-muted-foreground">{contact.phone}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 h-7 text-xs"
                    disabled={importing === contact.id}
                    onClick={() => handleImport(contact)}
                  >
                    {importing === contact.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Download className="w-3 h-3" />
                    }
                    Import
                  </Button>
                </div>
              ))}
            </div>
          )}

          {query.length >= 2 && !searching && results.length === 0 && (
            <p className="text-sm text-center text-muted-foreground py-4">
              No contacts found in High Level for "{query}"
            </p>
          )}

          {query.length < 2 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Type at least 2 characters to search
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── WooCommerce customer browser ──────────────────────────────────────────────
interface WooCustomer {
  wooId: number;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  city: string;
  postcode: string;
  registered: string;
  orderCount: number;
  totalSpent: string;
  alreadyImported: boolean;
}

function WooCustomersDialog({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [customers, setCustomers] = useState<WooCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [importingAll, setImportingAll] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on new search
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchCustomers = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "50" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/woo/customers?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCustomers(data.customers ?? []);
      setHasMore((data.customers?.length ?? 0) >= 50);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [open, page, debouncedSearch]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Reset when closed
  useEffect(() => {
    if (!open) { setPage(1); setSearch(""); setDebouncedSearch(""); setCustomers([]); setError(null); }
  }, [open]);

  const importOne = async (c: WooCustomer) => {
    setImporting(c.wooId);
    try {
      const res = await fetch("/api/woo/customers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wooIds: [c.wooId] }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      toast({
        title: data.created > 0 ? "Customer imported" : "Already exists",
        description: data.created > 0
          ? `${c.company || [c.firstName, c.lastName].filter(Boolean).join(" ")} added to your customers.`
          : "This customer already exists in your list.",
      });
      // Mark as imported in local list
      setCustomers(prev => prev.map(x => x.wooId === c.wooId ? { ...x, alreadyImported: true } : x));
      onImported();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  };

  const importAllVisible = async () => {
    const unimported = customers.filter(c => !c.alreadyImported);
    if (unimported.length === 0) { toast({ title: "Nothing to import", description: "All visible customers are already in your list." }); return; }
    setImportingAll(true);
    try {
      const res = await fetch("/api/woo/customers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wooIds: unimported.map(c => c.wooId) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      toast({
        title: "Import complete",
        description: `${data.created} created · ${data.skipped} skipped.`,
      });
      setCustomers(prev => prev.map(x => ({ ...x, alreadyImported: true })));
      onImported();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingAll(false);
    }
  };

  const unimportedCount = customers.filter(c => !c.alreadyImported).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            WooCommerce Customers
          </DialogTitle>
          <DialogDescription>
            Browse customers registered on your WooCommerce store. Import them individually or all at once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email or company…"
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={importAllVisible}
            disabled={importingAll || loading || unimportedCount === 0}
          >
            {importingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            Import all ({unimportedCount})
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading WooCommerce customers…</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm m-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          ) : customers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {debouncedSearch ? `No customers found matching "${debouncedSearch}"` : "No customers found in WooCommerce."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Name / Company</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Location</TableHead>
                  <TableHead className="text-xs text-center hidden sm:table-cell">Orders</TableHead>
                  <TableHead className="text-xs w-[110px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map(c => {
                  const displayName = c.company || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
                  const subName = c.company ? [c.firstName, c.lastName].filter(Boolean).join(" ") : null;
                  return (
                    <TableRow key={c.wooId} className="hover:bg-muted/20">
                      <TableCell>
                        <p className="text-sm font-medium">{displayName}</p>
                        {subName && <p className="text-xs text-muted-foreground">{subName}</p>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.email}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                        {[c.city, c.postcode].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm hidden sm:table-cell">{c.orderCount}</TableCell>
                      <TableCell>
                        {c.alreadyImported ? (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 gap-1">
                            <UserCheck className="w-3 h-3" /> Imported
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5"
                            disabled={importing === c.wooId || importingAll}
                            onClick={() => importOne(c)}
                          >
                            {importing === c.wooId
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Download className="w-3 h-3" />}
                            Import
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!hasMore || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatUKPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("07")) {
    return `${digits.slice(0,5)} ${digits.slice(5,8)} ${digits.slice(8)}`;
  }
  if (digits.length === 11 && digits.startsWith("01")) {
    return `${digits.slice(0,5)} ${digits.slice(5)}`;
  }
  if (digits.length === 11 && digits.startsWith("02")) {
    return `${digits.slice(0,3)} ${digits.slice(3,7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith("03")) {
    return `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
  }
  return raw;
}

const SHIPPING_SERVICES = [
  "DPD",
  "Local Delivery",
  "Office Collection",
  "Warehouse Collection",
  "Courier",
];

function isDpd(v: string) { return v === "DPD" || v === "DPD (Free)" || v === "DPD (Chargeable)"; }
function dpdDisplayValue(v: string) { return isDpd(v) ? "DPD" : v; }
function dpdChargeType(v: string): "Free" | "Chargeable" {
  if (v === "DPD (Free)") return "Free";
  return "Chargeable";
}

function CustomerTile({ customer, onEdit, onDelete, onClick }: {
  customer: Customer;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const contactName = [customer.contactFirstName, customer.contactLastName].filter(Boolean).join(" ");
  const initials = customer.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

  return (
    <div
      className="group relative bg-background border border-border/50 rounded-xl p-5 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
      onClick={onClick}
    >
      {/* Actions */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={onEdit}>
          <Edit2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Logo / Avatar */}
      <div className="flex items-center gap-3">
        {(customer as any).logoUrl ? (
          <img
            src={(customer as any).logoUrl}
            alt={customer.name}
            className="h-12 w-auto max-w-[120px] object-contain rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-primary">{initials}</span>
          </div>
        )}
      </div>

      {/* Company name */}
      <div>
        <p className="font-semibold text-foreground text-sm leading-tight line-clamp-2">{toTitleCase(customer.name)}</p>
      </div>

      {/* Contact details */}
      <div className="flex flex-col gap-1.5 mt-auto">
        {contactName && (
          <p className="text-xs text-muted-foreground truncate">{toTitleCase(contactName)}</p>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors truncate"
            onClick={e => e.stopPropagation()}
          >
            <Mail className="w-3 h-3 shrink-0" />
            <span className="truncate">{customer.email.toLowerCase()}</span>
          </a>
        )}
        {customer.phone && (
          <a
            href={`tel:${customer.phone.replace(/\s/g, "")}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Phone className="w-3 h-3 shrink-0" />
            <span>{formatUKPhone(customer.phone)}</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function Customers() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isHlImportOpen, setIsHlImportOpen] = useState(false);
  const [isWooImportOpen, setIsWooImportOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "tile">(() => {
    return (localStorage.getItem("customersViewMode") as "list" | "tile") ?? "tile";
  });
  
  const initialForm = { name: "", contactFirstName: "", contactLastName: "", email: "", phone: "", address: "", city: "", state: "", postcode: "", notes: "", defaultShippingService: "", logoUrl: "", highLevelContactId: "", poNumberRequired: false };
  const [formData, setFormData] = useState(initialForm);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => setFormData((f) => ({ ...f, logoUrl: `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}` })),
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Debounce search — only apply filter after 300 ms of idle typing,
  // and only when at least 3 characters have been entered.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 3) { setDebouncedSearch(""); return; } // below threshold → clear immediately
    const t = setTimeout(() => setDebouncedSearch(trimmed), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: allCustomers, isLoading } = useListCustomers();
  const customers = useMemo(() => {
    if (!allCustomers) return allCustomers;
    if (!debouncedSearch) return allCustomers;
    const term = debouncedSearch.toLowerCase();
    return allCustomers.filter((c) =>
      c.name.toLowerCase().includes(term) ||
      (c.email ?? "").toLowerCase().includes(term) ||
      (c.phone ?? "").toLowerCase().includes(term) ||
      (c.contactFirstName ?? "").toLowerCase().includes(term) ||
      (c.contactLastName ?? "").toLowerCase().includes(term)
    );
  }, [allCustomers, debouncedSearch]);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const deleteMutation = useDeleteCustomer();

  // Duplicate detection — only active when creating (not editing)
  const duplicateSuggestions = useMemo(() => {
    if (editingCustomer || !formData.name.trim() || formData.name.trim().length < 3) return [];
    return (allCustomers ?? [])
      .map((c) => ({ customer: c, score: customerNameSimilarity(formData.name, c.name) }))
      .filter(({ score }) => score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ customer }) => customer);
  }, [formData.name, allCustomers, editingCustomer]);

  const openCreateDialog = () => {
    setFormData(initialForm);
    setIsCreateOpen(true);
  };

  const openEditDialog = (customer: Customer) => {
    setFormData({
      name: toTitleCase(customer.name),
      contactFirstName: toTitleCase(customer.contactFirstName || ""),
      contactLastName: toTitleCase(customer.contactLastName || ""),
      email: (customer.email || "").toLowerCase(),
      phone: customer.phone || "",
      address: toTitleCase(customer.address || ""),
      city: toTitleCase(customer.city || ""),
      state: toTitleCase(customer.state || ""),
      postcode: customer.postcode || "",
      notes: customer.notes || "",
      defaultShippingService: (customer as any).defaultShippingService || "",
      logoUrl: (customer as any).logoUrl || "",
      highLevelContactId: (customer as any).highLevelContactId || "",
      poNumberRequired: (customer as any).poNumberRequired ?? false,
    });
    setEditingCustomer(customer);
  };

  const handleSave = () => {
    if (!formData.name) {
      toast({ title: "Validation Error", description: "Customer name is required", variant: "destructive" });
      return;
    }
    if (!formData.defaultShippingService) {
      toast({ title: "Validation Error", description: "Default Shipping Service is required", variant: "destructive" });
      return;
    }

    if (editingCustomer) {
      updateMutation.mutate(
        { id: editingCustomer.id, data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer updated successfully." });
            setEditingCustomer(null);
          }
        }
      );
    } else {
      createMutation.mutate(
        { data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer added successfully." });
            setIsCreateOpen(false);
          }
        }
      );
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this customer? This cannot be undone.")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer deleted successfully." });
          }
        }
      );
    }
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-1">Manage your client relationships.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsWooImportOpen(true)} className="gap-1.5">
              <ShoppingCart className="w-4 h-4" /> WooCommerce
            </Button>
            <Button variant="outline" onClick={() => setIsHlImportOpen(true)} className="gap-1.5">
              <Download className="w-4 h-4" /> Import from HL
            </Button>
            <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
              <Plus className="w-4 h-4 mr-2" /> Add Customer
            </Button>
          </div>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  className="pl-9 bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search.trim().length > 0 && search.trim().length < 3 && (
                  <p className="absolute left-0 top-full mt-1 text-xs text-muted-foreground">
                    Type {3 - search.trim().length} more character{3 - search.trim().length !== 1 ? "s" : ""} to search…
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 border border-border/50 rounded-lg p-1 bg-background">
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setViewMode("list"); localStorage.setItem("customersViewMode", "list"); }}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${viewMode === "tile" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setViewMode("tile"); localStorage.setItem("customersViewMode", "tile"); }}
                  title="Tile view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className={viewMode === "tile" ? "p-6" : "p-0"}>
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : customers && customers.length > 0 ? (
              viewMode === "tile" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {customers.map((customer) => (
                    <CustomerTile
                      key={customer.id}
                      customer={customer}
                      onClick={() => navigate(`/customers/${customer.id}`)}
                      onEdit={() => openEditDialog(customer)}
                      onDelete={() => handleDelete(customer.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Company Name</TableHead>
                        <TableHead className="hidden lg:table-cell">Primary Contact</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="hidden md:table-cell">Telephone</TableHead>
                        <TableHead className="w-[100px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((customer) => (
                        <TableRow key={customer.id} className="group hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/customers/${customer.id}`)}>
                          <TableCell className="font-medium text-foreground text-primary hover:underline">{toTitleCase(customer.name)}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {customer.contactFirstName || customer.contactLastName
                              ? toTitleCase(`${customer.contactFirstName || ''} ${customer.contactLastName || ''}`.trim())
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer.email ? customer.email.toLowerCase() : <span className="text-muted-foreground/50">No email</span>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell" onClick={e => e.stopPropagation()}>
                            {customer.phone ? (
                              <a
                                href={`tel:${customer.phone.replace(/\s/g, "")}`}
                                className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors group/tel"
                              >
                                <Phone className="w-3.5 h-3.5 text-muted-foreground group-hover/tel:text-primary shrink-0" />
                                {formatUKPhone(customer.phone)}
                              </a>
                            ) : (
                              <span className="text-sm text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => openEditDialog(customer)}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(customer.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No customers found</h3>
                <p className="mt-1">Add your first customer to get started.</p>
                <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Customer</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <ImportFromHlDialog
          open={isHlImportOpen}
          onOpenChange={setIsHlImportOpen}
          onImported={(customerId) => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            navigate(`/customers/${customerId}`);
          }}
        />

        <WooCustomersDialog
          open={isWooImportOpen}
          onOpenChange={setIsWooImportOpen}
          onImported={() => queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() })}
        />

        <Dialog open={isCreateOpen || !!editingCustomer} onOpenChange={(open) => {
          if (!open) { setIsCreateOpen(false); setEditingCustomer(null); }
        }}>
          <DialogContent
            className="sm:max-w-[600px] flex flex-col max-h-[90vh]"
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4 overflow-y-auto pr-1">
              <div className="grid gap-2">
                <Label htmlFor="name">Company / Full Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                {duplicateSuggestions.length > 0 && (
                  <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-medium leading-snug">Possible duplicate{duplicateSuggestions.length > 1 ? "s" : ""} found</p>
                      <p className="text-xs text-amber-700 mt-0.5">These customers already exist with a similar name:</p>
                      <ul className="mt-1.5 space-y-0.5">
                        {duplicateSuggestions.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="text-xs font-semibold underline underline-offset-2 hover:text-amber-900 text-left"
                              onClick={() => { setIsCreateOpen(false); navigate(`/customers/${c.id}`); }}
                            >
                              {c.name}
                            </button>
                            {c.city && <span className="text-xs text-amber-600 ml-1">· {c.city}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-2 mt-1">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Primary Contact</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="contactFirstName">First Name</Label>
                  <Input id="contactFirstName" value={formData.contactFirstName} onChange={(e) => setFormData({...formData, contactFirstName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contactLastName">Last Name</Label>
                  <Input id="contactLastName" value={formData.contactLastName} onChange={(e) => setFormData({...formData, contactLastName: e.target.value})} />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Address</h4>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="address">Street Address</Label>
                <Input id="address" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="state">Address Line 2</Label>
                <Input id="state" placeholder="Estate, district, etc." value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input id="postcode" value={formData.postcode} onChange={(e) => setFormData({...formData, postcode: e.target.value})} />
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Logo</h4>
              </div>

              <div className="flex items-center gap-4">
                <div
                  className="relative h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer hover:bg-muted/50 transition-colors flex-shrink-0"
                  onClick={() => logoFileInputRef.current?.click()}
                  title="Click to upload logo"
                >
                  {formData.logoUrl ? (
                    <UploadedImage src={formData.logoUrl} alt="Logo" className="h-full w-full object-contain p-1" fallback={<Upload className="w-5 h-5 text-muted-foreground" />} />
                  ) : isUploading ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*,.pdf,.eps,.ai"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={isUploading}
                    onClick={() => logoFileInputRef.current?.click()}
                  >
                    {isUploading ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3 mr-2" />{formData.logoUrl ? "Replace Logo" : "Upload Logo"}</>}
                  </Button>
                  <Input
                    type="url"
                    placeholder="or paste a logo URL (https://...)"
                    className="h-7 text-xs mt-0.5"
                    value={formData.logoUrl.startsWith("/api/") ? "" : formData.logoUrl}
                    onChange={e => setFormData(f => ({ ...f, logoUrl: e.target.value }))}
                  />
                  {formData.logoUrl && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 w-fit"
                      onClick={() => setFormData((f) => ({ ...f, logoUrl: "" }))}
                    >
                      <X className="w-3 h-3" /> Remove logo
                    </button>
                  )}
                  {!formData.logoUrl && (
                    <p className="text-xs text-muted-foreground">PNG, JPG, SVG, WebP, PDF or EPS. Click the square or the button to pick a file.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Integrations</h4>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="highLevelContactId">High Level Contact ID</Label>
                <Input
                  id="highLevelContactId"
                  placeholder="abc123xyz"
                  value={formData.highLevelContactId}
                  onChange={(e) => setFormData({...formData, highLevelContactId: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">Used to trigger High Level automation when sending collection order invoices. Find this in the contact's URL in High Level.</p>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Billing</h4>
              </div>

              <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.poNumberRequired}
                  onChange={(e) => setFormData({...formData, poNumberRequired: e.target.checked})}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary accent-primary cursor-pointer flex-shrink-0"
                />
                <div>
                  <p className="text-sm font-medium leading-tight">PO Number Required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Invoice cannot be sent until a PO number is added to the order.</p>
                </div>
              </label>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Shipping</h4>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="defaultShippingService">Default Shipping Service</Label>
                <Select
                  value={dpdDisplayValue(formData.defaultShippingService) || "none"}
                  onValueChange={(v) => {
                    if (v === "none") { setFormData({...formData, defaultShippingService: ""}); return; }
                    if (v === "DPD") { setFormData({...formData, defaultShippingService: "DPD (Chargeable)"}); return; }
                    setFormData({...formData, defaultShippingService: v});
                  }}
                >
                  <SelectTrigger id="defaultShippingService" className={!formData.defaultShippingService ? "border-destructive/60" : ""}>
                    <SelectValue placeholder="Select a carrier..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {SHIPPING_SERVICES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isDpd(formData.defaultShippingService) && (
                  <div className="flex gap-2 mt-1">
                    {(["Free", "Chargeable"] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormData({...formData, defaultShippingService: `DPD (${type})`})}
                        className={`flex-1 py-1.5 px-3 rounded-md border text-sm font-medium transition-colors ${
                          dpdChargeType(formData.defaultShippingService) === type
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Pre-fills the shipping service when creating orders for this customer.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingCustomer(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Customer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
