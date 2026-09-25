import { useState, useRef } from "react";
import Layout from "@/components/Layout";
import {
  useListSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  getListSuppliersQueryKey,
  Supplier
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpload } from "@workspace/object-storage-web";
import { UploadedImage } from "@/components/UploadedImage";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, Truck, Loader2, X, Upload } from "lucide-react";

const CURRENCY_LABELS: Record<string, string> = { GBP: "£ GBP", USD: "$ USD", EUR: "€ EUR" };
const CURRENCY_BADGE: Record<string, string> = { USD: "bg-green-100 text-green-800 border-green-200", EUR: "bg-blue-100 text-blue-800 border-blue-200", GBP: "" };

export default function Suppliers() {
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const blank = { name: "", contactName: "", email: "", phone: "", address: "", city: "", county: "", postcode: "", country: "United Kingdom", notes: "", currency: "GBP", defaultPriceBreaks: [] as { qty: number; price: number }[], logoUrl: "" };
  const [form, setForm] = useState(blank);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile: uploadLogo, isUploading: isLogoUploading } = useUpload({
    onSuccess: (res) => setForm((f) => ({ ...f, logoUrl: `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}` })),
    onError: () => toast({ title: "Logo upload failed", variant: "destructive" }),
  });

  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: suppliers, isLoading } = useListSuppliers({ search });
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();
  const deleteMutation = useDeleteSupplier();

  const openCreate = () => { setForm(blank); setIsCreateOpen(true); };
  const openEdit = (s: Supplier) => {
    setForm({
      name: s.name,
      contactName: s.contactName || "",
      email: s.email || "",
      phone: s.phone || "",
      address: s.address || "",
      city: s.city || "",
      county: s.county || "",
      postcode: s.postcode || "",
      country: s.country || "United Kingdom",
      notes: s.notes || "",
      currency: (s as unknown as { currency: string }).currency || "GBP",
      defaultPriceBreaks: Array.isArray((s as any).defaultPriceBreaks) ? (s as any).defaultPriceBreaks : [],
      logoUrl: (s as any).logoUrl || "",
    });
    setEditingSupplier(s);
  };

  const addPriceBreak = () => setForm(f => ({ ...f, defaultPriceBreaks: [...f.defaultPriceBreaks, { qty: 0, price: 0 }] }));
  const removePriceBreak = (i: number) => setForm(f => ({ ...f, defaultPriceBreaks: f.defaultPriceBreaks.filter((_, idx) => idx !== i) }));
  const updatePriceBreak = (i: number, field: "qty" | "price", raw: string) => {
    const val = field === "qty" ? parseInt(raw, 10) || 0 : parseFloat(raw) || 0;
    setForm(f => {
      const breaks = [...f.defaultPriceBreaks];
      breaks[i] = { ...breaks[i], [field]: val };
      return { ...f, defaultPriceBreaks: breaks };
    });
  };

  const handleSave = () => {
    if (!form.name) {
      toast({ title: "Validation Error", description: "Supplier name is required", variant: "destructive" });
      return;
    }
    const inv = () => qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() });

    if (editingSupplier) {
      updateMutation.mutate(
        { id: editingSupplier.id, data: form },
        { onSuccess: () => { inv(); toast({ title: "Supplier updated" }); setEditingSupplier(null); } }
      );
    } else {
      createMutation.mutate(
        { data: form },
        { onSuccess: () => { inv(); toast({ title: "Supplier added" }); setIsCreateOpen(false); } }
      );
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this supplier? This cannot be undone.")) {
      deleteMutation.mutate(
        { id },
        { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); toast({ title: "Supplier deleted" }); } }
      );
    }
  };

  const close = () => { setIsCreateOpen(false); setEditingSupplier(null); };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Suppliers</h1>
            <p className="text-muted-foreground mt-1">Manage your purchasing suppliers.</p>
          </div>
          <Button onClick={openCreate} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> Add Supplier
          </Button>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : suppliers && suppliers.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Supplier Name</TableHead>
                      <TableHead className="hidden md:table-cell">Contact</TableHead>
                      <TableHead>Email / Phone</TableHead>
                      <TableHead className="hidden lg:table-cell">Location</TableHead>
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suppliers.map((s) => (
                      <TableRow key={s.id} className="group hover:bg-muted/30">
                        <TableCell className="font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            {s.name}
                            {(s as unknown as { currency: string }).currency && (s as unknown as { currency: string }).currency !== "GBP" && (
                              <Badge variant="outline" className={`text-xs ${CURRENCY_BADGE[(s as unknown as { currency: string }).currency] ?? ""}`}>
                                {(s as unknown as { currency: string }).currency}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{s.contactName || '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-col text-sm text-muted-foreground">
                            <span>{s.email || 'No email'}</span>
                            <span>{s.phone || 'No phone'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {s.city ? `${s.city}${s.county ? `, ${s.county}` : ''}` : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => openEdit(s)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(s.id)}>
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
                <Truck className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No suppliers yet</h3>
                <p className="mt-1">Add your first supplier to start linking products.</p>
                <Button onClick={openCreate} variant="outline" className="mt-6">Add Supplier</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen || !!editingSupplier} onOpenChange={(open) => { if (!open) close(); }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Supplier Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Wholesale Ltd" />
              </div>
              <div className="grid gap-2">
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2 mt-1">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Address</h4>
              </div>
              <div className="grid gap-2">
                <Label>Street Address</Label>
                <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
                <div className="grid gap-2"><Label>County</Label><Input value={form.county} onChange={e => setForm({ ...form, county: e.target.value })} /></div>
                <div className="grid gap-2"><Label>Postcode</Label><Input value={form.postcode} onChange={e => setForm({ ...form, postcode: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Purchasing Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP">£ GBP — British Pound</SelectItem>
                      <SelectItem value="USD">$ USD — US Dollar</SelectItem>
                      <SelectItem value="EUR">€ EUR — Euro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Country</Label>
                  <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              <div className="grid gap-2">
                <Label>Supplier Logo</Label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {form.logoUrl ? (
                      <UploadedImage src={form.logoUrl} alt="Logo" className="h-full w-full object-contain p-1" fallback={<Upload className="w-5 h-5 text-muted-foreground" />} />
                    ) : (
                      <Truck className="w-7 h-7 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={isLogoUploading} onClick={() => logoInputRef.current?.click()}>
                      {isLogoUploading ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3 mr-1.5" />{form.logoUrl ? "Replace Logo" : "Upload Logo"}</>}
                    </Button>
                    {form.logoUrl && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={() => setForm(f => ({ ...f, logoUrl: "" }))}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Default Price Breaks</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addPriceBreak}>
                    <Plus className="w-3 h-3 mr-1" /> Add Break
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">Auto-applied to products when this supplier is selected (if the product has no price breaks).</p>
                {form.defaultPriceBreaks.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No default price breaks set.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
                      <span>Min Qty</span>
                      <span>Unit Price ({form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : "£"})</span>
                      <span />
                    </div>
                    {form.defaultPriceBreaks.map((pb, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <Input type="number" min="1" step="1" value={pb.qty || ""} onChange={e => updatePriceBreak(i, "qty", e.target.value)} placeholder="e.g. 50" className="h-8 text-sm" />
                        <Input type="number" min="0" step="0.01" value={pb.price || ""} onChange={e => updatePriceBreak(i, "price", e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => removePriceBreak(i)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Supplier"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
