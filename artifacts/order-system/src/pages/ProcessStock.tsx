import { useState, useRef } from "react";
import Layout from "@/components/Layout";
import { KitDesignerText } from "@/components/KitDesignerText";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListSuppliers } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Edit2, Trash2, Loader2, Boxes, AlertTriangle, Check, ChevronsUpDown, Paperclip, Download, X, Upload } from "lucide-react";
import { FileDropZone, FileDropZoneContent } from "@/components/FileDropZone";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProcessStockItem {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  unitCost: number;
  stockQuantity: number;
  supplierId: number | null;
  supplierCode: string | null;
  supplierName: string | null;
  customerId: number | null;
  customerName: string | null;
  notes: string | null;
  fileUrl: string | null;
}

interface Customer { id: number; name: string; }

const BLANK_FORM = {
  name: "",
  sku: "",
  unitCost: "",
  stockQuantity: "0",
  customerId: "" as string,
  supplierId: "" as string,
  notes: "",
  fileUrl: null as string | null,
};

function InlineQty({ id, value, onSaved }: { id: number; value: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const commit = async () => {
    const num = parseInt(draft, 10);
    if (!isNaN(num) && num >= 0 && num !== value) {
      try {
        await apiFetch(`/process-stock/${id}`, { method: "PATCH", body: JSON.stringify({ stockQuantity: num }) });
        onSaved();
      } catch (e) {
        toast({ title: "Failed to update", description: (e as Error).message, variant: "destructive" });
        setDraft(String(value));
      }
    } else {
      setDraft(String(value));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
        className="w-16 text-right border border-primary rounded px-1 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
        autoFocus
      />
    );
  }

  const low = value <= 5;
  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true); setTimeout(() => inputRef.current?.select(), 10); }}
      title="Click to edit quantity"
      className="cursor-pointer"
    >
      {low ? (
        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1 font-semibold hover:bg-amber-100 transition-colors">
          <AlertTriangle className="w-3 h-3" />{value}
        </Badge>
      ) : (
        <span className="font-semibold tabular-nums hover:text-primary hover:underline transition-colors">{value}</span>
      )}
    </button>
  );
}

export function ProcessStockTab() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [customerComboOpen, setCustomerComboOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessStockItem | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: suppliers } = useListSuppliers();
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["customers-list"],
    queryFn: () => apiFetch("/customers"),
  });

  const { data: items, isLoading } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock", search],
    queryFn: () => apiFetch(`/process-stock${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const { uploadFile } = useUpload({
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const inv = () => qc.invalidateQueries({ queryKey: ["process-stock"] });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing
        ? apiFetch(`/process-stock/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : apiFetch("/process-stock", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      inv();
      toast({ title: "Saved", description: editing ? "Stock item updated." : "Stock item created." });
      setOpen(false);
      setEditing(null);
      setPendingFile(null);
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/process-stock/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const fetchSuggestedSku = async () => {
    try {
      const { sku } = await apiFetch<{ sku: string }>("/process-stock/suggest-sku");
      return sku;
    } catch {
      return "";
    }
  };

  const raptorId = suppliers?.find(s => s.name.toLowerCase().includes("raptor"))?.id ?? null;

  const openCreate = async () => {
    const suggested = await fetchSuggestedSku();
    setForm({ ...BLANK_FORM, sku: suggested, supplierId: raptorId ? String(raptorId) : "" });
    setPendingFile(null);
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (item: ProcessStockItem) => {
    // If the item has no supplier set, default to Raptor so the form surfaces the gap
    const supplierDefault = item.supplierId ?? raptorId;
    setForm({
      name: item.name,
      sku: item.sku ?? "",
      unitCost: item.unitCost ? item.unitCost.toString() : "",
      stockQuantity: item.stockQuantity.toString(),
      customerId: item.customerId?.toString() ?? "",
      supplierId: supplierDefault ? String(supplierDefault) : "",
      notes: [item.description, item.notes].filter(Boolean).join("\n").trim(),
      fileUrl: item.fileUrl ?? null,
    });
    setPendingFile(null);
    setEditing(item);
    setOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "eps" && ext !== "pdf") {
      toast({ title: "Invalid file type", description: "Please upload an EPS or PDF file.", variant: "destructive" });
      return;
    }
    setPendingFile(file);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (!editing && !form.customerId) {
      toast({ title: "Customer required", description: "Process stock must be assigned to a customer.", variant: "destructive" });
      return;
    }

    let fileUrl = form.fileUrl ?? null;

    if (pendingFile) {
      setIsUploadingFile(true);
      try {
        const result = await uploadFile(pendingFile);
        fileUrl = result.objectPath;
      } catch {
        setIsUploadingFile(false);
        return;
      }
      setIsUploadingFile(false);
    }

    const sku = form.sku.trim() || null;
    const parsedQty = parseInt(form.stockQuantity, 10) || 0;
    const parsedSupplierId = form.supplierId ? parseInt(form.supplierId, 10) : null;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      sku,
      description: null,
      unitCost: parseFloat(form.unitCost) || 0,
      supplierId: parsedSupplierId,
      supplierCode: sku,
      customerId: form.customerId ? parseInt(form.customerId, 10) : null,
      notes: form.notes.trim() || null,
      fileUrl,
    };
    // Only include stockQuantity in the payload when creating a new item, or
    // when the user explicitly changed it from the value loaded into the form.
    // This prevents a stale edit dialog from overwriting stock that was booked
    // in after the dialog was opened.
    if (!editing || parsedQty !== editing.stockQuantity) {
      payload.stockQuantity = parsedQty;
    }
    saveMutation.mutate(payload);
  };

  const handleDelete = (item: ProcessStockItem) => {
    if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const lowStock = (qty: number) => qty <= 5;
  const isBusy = saveMutation.isPending || isUploadingFile;

  const fileDisplayName = (url: string) => {
    const parts = url.split("/");
    return parts[parts.length - 1] || "Attached file";
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Physical materials used in decoration processes — print, embroidery, etc.</p>
        <Button onClick={openCreate} className="shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
          <Plus className="w-4 h-4 mr-2" /> Add Stock Item
        </Button>
      </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : items && items.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[100px]">SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">Customer</TableHead>
                      <TableHead className="hidden lg:table-cell">Supplier</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">In Stock</TableHead>
                      <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id} className="group hover:bg-muted/30">
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]"><KitDesignerText>{item.description}</KitDesignerText></p>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {item.customerName
                            ? <span className="text-sm font-medium">{item.customerName}</span>
                            : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {item.supplierName ? (
                            <div>
                              <p className="text-sm">{item.supplierName}</p>
                              {item.supplierCode && <p className="text-xs text-muted-foreground font-mono">{item.supplierCode}</p>}
                            </div>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(item.unitCost)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <InlineQty id={item.id} value={item.stockQuantity} onSaved={inv} />
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {item.fileUrl && (
                              <a
                                href={`${API_BASE}/storage/objects/${item.fileUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download file"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={() => handleDelete(item)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <Boxes className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="text-lg font-medium text-foreground">No process stock items</h3>
                <p className="mt-1">Add the physical materials you source from suppliers for decoration.</p>
                <Button onClick={openCreate} variant="outline" className="mt-6">Add Stock Item</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setPendingFile(null); } }}>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle className="font-display">{editing ? "Edit Stock Item" : "Add Process Stock Item"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input
                  placeholder="e.g. Netty Stars Large Logo"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>
                    Product Code
                    <span className="ml-1 text-xs text-muted-foreground font-normal">(SKU or auto-generated process code)</span>
                  </Label>
                  <Input
                    placeholder="e.g. SKU0001 or PS0001"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Unit Cost (£) <span className="text-muted-foreground font-normal text-xs">optional</span></Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Supplier</Label>
                <Select
                  value={form.supplierId}
                  onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}
                >
                  <SelectTrigger className={!form.supplierId ? "border-amber-300 text-muted-foreground" : ""}>
                    <SelectValue placeholder="Select supplier…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {suppliers?.map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!form.supplierId && (
                  <p className="text-xs text-amber-600">No supplier set — it will appear under "Unknown Supplier" in Purchasing</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Customer {!editing && <span className="text-destructive">*</span>}</Label>
                  <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerComboOpen}
                        className={`justify-between font-normal w-full ${!editing && !form.customerId ? "border-amber-300 text-muted-foreground" : ""}`}
                      >
                        <span className="truncate">
                          {form.customerId
                            ? customers?.find(c => c.id.toString() === form.customerId)?.name ?? "Unknown"
                            : "Select a customer…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[240px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search customers..." />
                        <CommandList>
                          <CommandEmpty>No customer found.</CommandEmpty>
                          <CommandGroup>
                            {editing && (
                              <CommandItem value="none" onSelect={() => { setForm({ ...form, customerId: "" }); setCustomerComboOpen(false); }}>
                                <Check className={`mr-2 h-4 w-4 ${!form.customerId ? "opacity-100" : "opacity-0"}`} />
                                No customer / global
                              </CommandItem>
                            )}
                            {customers?.map(c => (
                              <CommandItem key={c.id} value={c.name} onSelect={() => { setForm({ ...form, customerId: c.id.toString() }); setCustomerComboOpen(false); }}>
                                <Check className={`mr-2 h-4 w-4 ${form.customerId === c.id.toString() ? "opacity-100" : "opacity-0"}`} />
                                {c.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="grid gap-2">
                  <Label>Stock Quantity</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.stockQuantity}
                    onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
                  />
                </div>
              </div>

              {/* File upload */}
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  Artwork File
                  <span className="text-muted-foreground font-normal text-xs">(EPS or PDF)</span>
                </Label>
                {form.fileUrl && !pendingFile ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border bg-muted/30">
                    <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1 font-mono">
                      {fileDisplayName(form.fileUrl)}
                    </span>
                    <a
                      href={`${API_BASE}/storage/objects/${form.fileUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-xs shrink-0"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, fileUrl: null })}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : pendingFile ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border border-primary/30 bg-primary/5">
                    <Paperclip className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">{pendingFile.name}</span>
                    <button
                      type="button"
                      onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <FileDropZone
                    onFile={(file) => {
                      const ext = file.name.split(".").pop()?.toLowerCase();
                      if (ext !== "eps" && ext !== "pdf") {
                        toast({ title: "Invalid file type", description: "Please upload an EPS or PDF file.", variant: "destructive" });
                        return;
                      }
                      setPendingFile(file);
                    }}
                    accept=".eps,.pdf,application/postscript,application/pdf"
                    dialogOpen={open}
                    className="py-2.5 px-3 flex-row gap-2 justify-start"
                  >
                    <Upload className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Click or drag to upload EPS or PDF</span>
                  </FileDropZone>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  placeholder="Application notes, placement details, internal info..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setPendingFile(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={isBusy || !form.name.trim()}>
                {isUploadingFile
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Uploading...</>
                  : saveMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving...</>
                  : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}

export default function ProcessStock() {
  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Process Stock</h1>
          <p className="text-muted-foreground mt-1">Physical materials used in decoration processes — print, embroidery, etc.</p>
        </div>
        <ProcessStockTab />
      </div>
    </Layout>
  );
}
