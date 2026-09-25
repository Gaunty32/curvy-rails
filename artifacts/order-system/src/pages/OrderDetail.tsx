import { useState, useEffect, useRef } from "react";
import { printDpdLabelHtml } from "@/utils/printDpdLabel";
import Layout from "@/components/Layout";
import { useRoute, useLocation } from "wouter";
import {
  useGetOrder,
  useUpdateOrder,
  useAddOrderItem,
  useDeleteOrderItem,
  useListProducts,
  useListCustomers,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getListCustomersQueryKey,
  UpdateOrderBodyStatus
} from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmOrderDialog } from "@/components/ConfirmOrderDialog";
import { SendAcknowledgementDialog } from "@/components/SendAcknowledgementDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { sortSizesWithOrder, sortSizes, abbreviateSizeLabel } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { useToast } from "@/hooks/use-toast";
import { usePriceConfirm } from "@/components/PriceConfirmDialog";
import { ArrowLeft, Plus, Minus, Trash2, FileText, PackageX, Loader2, Check, ChevronsUpDown, ChevronLeft, Palette, Ruler, Sparkles, User, Archive, Link as LinkIcon, ShoppingBag, Package, ClipboardList, PackageCheck, Printer, CheckCircle2, Clock, TriangleAlert, Calendar, Pencil, BookOpen, ExternalLink, MapPin, Wand2, Truck, Globe, XCircle, X, Mail, Lock, LockOpen, Download, MessageSquare, Paperclip, Search, RotateCcw, Lightbulb, BadgePercent, Wrench, Package2, GitMerge, TrendingUp } from "lucide-react";
import { OrderMessages } from "@/components/OrderMessages";
import { FileDropZone, FileDropZoneContent } from "@/components/FileDropZone";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

const DEFAULT_CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

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

interface ProductAttribute { id: number; productId: number; type: string; value: string; }
interface ProductVariant { id: number; productId: number; colour: string | null; size: string | null; stockQty: number | null; price: number | null; }
interface CustomerFinish { id: number; customerId: number; name: string; description: string | null; totalCost: number; processes: { id: number; name: string; price: number | null }[]; }
interface EmployeeSize { id: number; label: string; size: string; }
interface CustomerEmployee { id: number; customerId: number; firstName: string; lastName: string | null; jobTitle: string | null; roleId: number | null; roleName: string | null; department: string | null; deliveryAddressId: number | null; sizes: EmployeeSize[]; }
interface CustomerFinishedItem { id: number; name: string; productId: number; roleId: number | null; roleName: string | null; productName: string | null; productSku: string | null; finishId: number | null; finishName: string | null; colour: string | null; size: string | null; unitPrice: number; specialPrice: number | null; notes: string | null; }
interface DeliveryAddress { id: number; customerId: number; label: string | null; line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null; isDefault: boolean; }

function getAdditionalLogoCost(processes: Array<{ price?: number | string | null }>): number {
  const prices = processes.map(process => {
    const price = Number(process.price ?? 0);
    return Number.isFinite(price) ? Math.max(0, price) : 0;
  });
  if (prices.length === 0) return 0;
  // The standard £4 logo is the one already included in the garment price.
  // Do not infer this from the largest process: a different-priced logo can
  // be an additional charge, and two £4 logos still means one is extra.
  const includedMainLogoIndex = prices.findIndex(price => Math.abs(price - 4) < 0.005);
  const includedMainLogoCost = includedMainLogoIndex === -1 ? 0 : prices[includedMainLogoIndex];
  return Math.max(0, prices.reduce((sum, price) => sum + price, 0) - includedMainLogoCost);
}

function PoNumberInline({ orderId, current }: { orderId: number; current: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ poNumber: value || null }),
      });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    } catch {
      toast({ title: "Could not save PO number", variant: "destructive" });
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5">
        <input
          autoFocus
          className="text-sm border rounded px-2 py-0.5 font-mono w-44 outline-none focus:ring-1 focus:ring-primary/40"
          placeholder="e.g. PO-2026-0042"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
      </div>
    );
  }

  return (
    <button
      className="flex items-center gap-1.5 mt-1.5 group"
      onClick={() => setEditing(true)}
      title="Click to edit PO number"
    >
      {current ? (
        <span className="text-sm font-mono text-muted-foreground group-hover:text-foreground transition-colors">
          PO: {current}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/60 group-hover:text-muted-foreground transition-colors italic">
          + Add PO number
        </span>
      )}
      <Pencil className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </button>
  );
}

function AttentionOfCard({ orderId, current }: { orderId: number; current: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ attentionOf: value || null }),
      });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    } catch {
      toast({ title: "Could not save attention of field", variant: "destructive" });
    }
  };

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> For the Attention Of
          </CardTitle>
          {!editing && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(true); }}>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="py-4">
        {editing ? (
          <div className="space-y-2">
            <input
              autoFocus
              className="text-sm border rounded px-2 py-1.5 w-full outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="e.g. John Smith"
              value={value}
              onChange={e => setValue(e.target.value)}
              onBlur={save}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setValue(current ?? ""); } }}
            />
            <p className="text-xs text-muted-foreground">This name appears on the delivery note</p>
          </div>
        ) : (
          <p className={`text-sm ${current ? "text-foreground" : "text-muted-foreground italic"}`}>
            {current ?? "Not set"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function useProductAttributes(productId: number | null) {
  return useQuery<ProductAttribute[]>({
    queryKey: ["product-attributes", productId],
    queryFn: () => apiFetch(`/products/${productId}/attributes`),
    enabled: productId !== null && productId > 0,
  });
}

function useProductVariants(productId: number | null) {
  return useQuery<ProductVariant[]>({
    queryKey: ["product-variants-detail", productId],
    queryFn: () => apiFetch(`/products/${productId}/variants`),
    enabled: productId !== null && productId > 0,
  });
}

function useCustomerFinishes(customerId: number | null) {
  return useQuery<CustomerFinish[]>({
    queryKey: ["customer-finishes", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/finishes`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerEmployees(customerId: number | null) {
  return useQuery<CustomerEmployee[]>({
    queryKey: ["customer-employees", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/employees`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerRoles(customerId: number | null) {
  return useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["customer-roles", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/roles`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerTeams(customerId: number | null) {
  return useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["customer-teams", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/teams`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerFinishedItems(customerId: number | null) {
  return useQuery<CustomerFinishedItem[]>({
    queryKey: ["customer-finished-items", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/finished-items`),
    enabled: customerId !== null && customerId > 0,
  });
}

interface WardrobeData {
  items: any[];
  processes: any[];
  sizesMap: Record<string, Record<string, string[]>>;
  sleevesMap: Record<string, string[]>;
}
function useCustomerWardrobeData(customerId: number | null) {
  return useQuery<WardrobeData>({
    queryKey: ["customer-wardrobe-data", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/wardrobe-data`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerDeliveryAddresses(customerId: number | null) {
  return useQuery<DeliveryAddress[]>({
    queryKey: ["customer-delivery-addresses", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/addresses`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerInvoiceAddresses(customerId: number | null) {
  return useQuery<Array<{ id: number; label: string | null; name: string | null; address: string | null; line2: string | null; city: string | null; postcode: string | null; billingEmail: string | null; isDefault: boolean | null }>>({
    queryKey: ["customer-invoice-addresses", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/invoice-addresses`),
    enabled: customerId !== null && customerId > 0,
  });
}

/** Returns the unit price for a given total quantity from a price-break table.
 *  Returns the price for the highest tier whose min qty is ≤ totalQty.
 *  Returns null if no tier matches (quantity below minimum). */
function getBreakPrice(
  priceBreaks: { qty: number; price: number }[] | null | undefined,
  totalQty: number,
): number | null {
  if (!priceBreaks || priceBreaks.length === 0) return null;
  const sorted = [...priceBreaks].sort((a, b) => a.qty - b.qty);
  let result: number | null = null;
  for (const tier of sorted) {
    if (totalQty >= tier.qty) result = tier.price;
  }
  return result;
}

/** Returns a friendly price-break suggestion toast payload, or null if none applies.
 *  totalQty = existing order qty + qty just added.
 *  priorQty = existing order qty before this add (used to detect newly crossed tiers). */
function getPriceBreakSuggestion(
  productName: string,
  totalQty: number,
  priorQty: number,
  priceBreaks: { qty: number; price: number }[],
  unitPrice: number,
): { title: string; description: string } | null {
  if (!priceBreaks.length) return null;
  // Normalise price to number — it may arrive as a string from JSON
  const sorted = [...priceBreaks]
    .map(pb => ({ qty: Number(pb.qty), price: parseFloat(String(pb.price)) }))
    .filter(pb => !isNaN(pb.price))
    .sort((a, b) => a.qty - b.qty);

  // Celebrate if they just crossed into a new tier
  const justUnlocked = sorted.filter(pb => pb.qty <= totalQty && pb.qty > priorQty);
  if (justUnlocked.length > 0) {
    const best = justUnlocked[justUnlocked.length - 1];
    return {
      title: "Bulk rate unlocked!",
      description: `${productName} are now £${best.price.toFixed(2)} each at this quantity.`,
    };
  }

  // Suggest the next reachable tier
  const nextTier = sorted.find(pb => pb.qty > totalQty);
  if (!nextTier) return null;
  const saving = unitPrice - nextTier.price;
  if (saving < 0.01) return null;

  const needed = nextTier.qty - totalQty;
  const isClose = needed <= Math.ceil(nextTier.qty * 0.35);
  if (isClose) {
    return {
      title: "Almost there!",
      description: `Add just ${needed} more ${productName} to unlock £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
    };
  }
  return {
    title: "Bulk discount tip",
    description: `Did you know? Order ${nextTier.qty}+ ${productName} and the price drops to £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
  };
}

const EMPTY_ITEM = {
  productId: null as number | null,
  productName: "",
  colour: "",
  size: "",
  finishId: null as number | null,
  finishName: null as string | null,
  finishCost: 0,
  recipientType: "stock" as "stock" | "person",
  recipientName: "",
  recipientEmployeeId: null as number | null,
  quantity: 1,
  unitPrice: "",
  baseUnitPrice: "",
  vatRate: 0.20,
  fromWardrobe: false,
};

export default function OrderDetail() {
  const [, params] = useRoute("/orders/:id");
  const orderId = params?.id ? parseInt(params.id, 10) : 0;
  const [, navigate] = useLocation();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirmIfNotWhole, dialog: priceConfirmDialog } = usePriceConfirm();
  const sizeOrder = useSizeOrder();

  const { data: order, isLoading: isOrderLoading } = useGetOrder(orderId);
  const { data: products } = useListProducts();
  const serviceProducts = products?.filter(p => (p as any).isService === true);

  const { data: bundles = [] } = useQuery<Array<{ id: number; name: string; sku: string | null; price: string | number; is_active: boolean; component_count: number }>>({
    queryKey: ["bundles"],
    queryFn: () => apiFetch("/bundles"),
  });

  // Must be declared BEFORE the bundleDetails useQuery that references addBundleId
  const [isAddBundleOpen, setIsAddBundleOpen] = useState(false);
  const [addBundleId, setAddBundleId] = useState<number | null>(null);
  const [addBundleWearerName, setAddBundleWearerName] = useState("");
  const [compOverrides, setCompOverrides] = useState<Record<number, { colour: string; size: string; finishId?: number | null; finishName?: string | null }>>({});

  const { data: bundleDetails } = useQuery<{
    id: number; name: string;
    components: Array<{
      id: number; resolved_name: string; quantity: number;
      p_is_service: boolean | null;
      variants: Array<{ colour: string; size: string }> | null;
    }>;
  }>({
    queryKey: ["bundle-detail", addBundleId],
    queryFn: () => apiFetch(`/bundles/${addBundleId}`),
    enabled: addBundleId != null,
  });

  const updateOrderMutation = useUpdateOrder();
  const addItemMutation = useAddOrderItem();
  const deleteItemMutation = useDeleteOrderItem();
  const sendToPurchasingMutation = useMutation({
    mutationFn: (itemId: number) =>
      apiFetch(`/orders/${orderId}/items/${itemId}/send-to-purchasing`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Sent to Purchasing", description: "This line is no longer marked ready for dispatch." });
    },
    onError: (error: Error) =>
      toast({ title: "Could not send to Purchasing", description: error.message, variant: "destructive" }),
  });

  const applyPriceBreakMutation = useMutation({
    mutationFn: ({ productId, unitPrice }: { productId: number; unitPrice: number }) =>
      apiFetch(`/orders/${orderId}/items/bulk-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, unitPrice }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      const prompt = priceBreakPromptRef.current;
      if (prompt) {
        toast({ title: "Price updated", description: `${prompt.productName} updated to £${vars.unitPrice.toFixed(2)} on all lines.` });
      }
      setPriceBreakPrompt(null);
    },
    onError: (e: Error) => toast({ title: "Could not update price", description: e.message, variant: "destructive" }),
  });

  const addBundleMutation = useMutation({
    mutationFn: ({ bundleId, wearerName, componentOverrides }: { bundleId: number; wearerName?: string; componentOverrides?: Array<{ componentId: number; colour?: string; size?: string }> }) =>
      apiFetch(`/bundles/${bundleId}/add-to-order/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 1, wearerName: wearerName || null, componentOverrides }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setIsAddBundleOpen(false);
      setAddBundleId(null);
      setAddBundleWearerName("");
      setCompOverrides({});
      toast({ title: "Bundle added", description: addBundleWearerName ? `Added for ${addBundleWearerName}` : "Bundle added to order" });
    },
    onError: (e: Error) => toast({ title: "Could not add bundle", description: e.message, variant: "destructive" }),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      if (order?.customerId) {
        queryClient.invalidateQueries({ queryKey: ["customer", order.customerId, "orders"] });
      }
      toast({ title: "Order deleted" });
      navigate("/orders");
    },
    onError: (e: Error) => toast({ title: "Could not delete order", description: e.message, variant: "destructive" }),
  });

  const mergeIntoMutation = useMutation({
    mutationFn: (targetId: number) => apiFetch<{ targetId: number }>(`/orders/${orderId}/merge-into/${targetId}`, { method: "POST" }),
    onSuccess: ({ targetId }) => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Orders merged", description: "Items have been moved to the target order." });
      navigate(`/orders/${targetId}`);
    },
    onError: (e: Error) => toast({ title: "Could not merge orders", description: e.message, variant: "destructive" }),
  });

  const returnToStockMutation = useMutation({
    mutationFn: (items: Array<{ orderItemId: number; quantity: number; type: "plain" | "finished"; unitPrice?: number; notes?: string }>) =>
      apiFetch<{ results: Array<{ orderItemId: number; ok: boolean; message: string }> }>(`/orders/${orderId}/return-to-stock`, {
        method: "POST",
        body: JSON.stringify({ items }),
      }),
    onSuccess: ({ results }) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      const failed = results.filter(r => !r.ok);
      if (failed.length === 0) {
        setReturnToStockOpen(false);
        toast({ title: "Stock returned", description: "Items have been booked back into stock." });
      } else {
        const succeeded = results.filter(r => r.ok).length;
        toast({
          title: failed.length === results.length ? "Could not return stock" : `${succeeded} item${succeeded !== 1 ? "s" : ""} returned, ${failed.length} failed`,
          description: failed.map(f => f.message).join("; "),
          variant: "destructive",
        });
        if (succeeded > 0) setReturnToStockOpen(false);
      }
    },
    onError: (e: Error) => toast({ title: "Could not return stock", description: e.message, variant: "destructive" }),
  });

  const customerId = order?.customerId ?? null;
  const { data: allCustomers = [] } = useListCustomers();
  const createWebsiteCustomerMutation = useMutation({
    mutationFn: () => apiFetch<{ customerId: number; customerName: string }>(
      `/shop/admin/orders/${orderId}/create-customer`,
      { method: "POST" },
    ),
    onSuccess: ({ customerName }) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({
        title: "Customer account created and linked",
        description: `${customerName} is now ready for this order to be confirmed.`,
      });
    },
    onError: (error: Error) => {
      let description = error.message;
      try {
        description = JSON.parse(error.message).error ?? description;
      } catch {
        // The API can also return plain-text errors.
      }
      toast({ title: "Could not create customer account", description, variant: "destructive" });
    },
  });

  const { data: customerFinishes } = useCustomerFinishes(customerId);
  const { data: customerEmployees, refetch: refetchEmployees } = useCustomerEmployees(customerId);
  const { data: customerRoles = [] } = useCustomerRoles(customerId);
  const { data: customerTeams = [] } = useCustomerTeams(customerId);
  const { data: customerFinishedItems } = useCustomerFinishedItems(customerId);
  const { data: wardrobeData } = useCustomerWardrobeData(customerId);
  const { data: customerDeliveryAddresses } = useCustomerDeliveryAddresses(customerId);
  const { data: customerInvoiceAddresses } = useCustomerInvoiceAddresses(customerId);

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [serviceProductSearchOpen, setServiceProductSearchOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"wardrobe" | "custom" | "service">("wardrobe");
  const [item, setItem] = useState({ ...EMPTY_ITEM });
  const [sizeRows, setSizeRows] = useState<Array<{ size: string; qty: number }>>([{ size: "", qty: 1 }]);
  const [isAddingMulti, setIsAddingMulti] = useState(false);
  const [priceOverrideEnabled, setPriceOverrideEnabled] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<CustomerEmployee | null>(null);
  const [isNewPerson, setIsNewPerson] = useState(false);
  const [lastOrderedSizes, setLastOrderedSizes] = useState<{
    byProductId: Record<string, { size: string; colour: string | null; productName: string }>;
    byProductName: Record<string, { size: string; colour: string | null; productId: number | null }>;
  }>({ byProductId: {}, byProductName: {} });

  // ── Wardrobe tab: person-first picker state ────────────────────────────────
  // null = no person selected yet (show person picker)
  // "stock" = ordering as bulk stock
  // CustomerEmployee = ordering for a specific person
  const [wardrobeRecipient, setWardrobeRecipient] = useState<null | "stock" | CustomerEmployee>(null);
  const [wardrobeItemSizes, setWardrobeItemSizes] = useState<Record<number, string>>({});
  const [empSearch, setEmpSearch] = useState("");
  const [addRecipientOpen, setAddRecipientOpen] = useState(false);
  const [addRecipientForm, setAddRecipientForm] = useState({
    firstName: "",
    lastName: "",
    jobTitle: "",
    teamId: null as number | null,
  });
  const [addRecipientSaving, setAddRecipientSaving] = useState(false);
  const [wardrobeItemSleeves, setWardrobeItemSleeves] = useState<Record<number, string>>({});
  const [wardrobeSearch, setWardrobeSearch] = useState("");
  const [wardrobeItemQtys, setWardrobeItemQtys] = useState<Record<number, number>>({});
  const [wardrobeBulkModes, setWardrobeBulkModes] = useState<Record<number, boolean>>({});
  const [wardrobeBulkQtys, setWardrobeBulkQtys] = useState<Record<number, Record<string, number>>>({});
  const [employeeEdits, setEmployeeEdits] = useState<Record<number, { roleId: number | null; deliveryAddressId: number | null }>>({});

  const saveEmployeeDetails = useMutation({
    mutationFn: ({ employeeId, roleId, deliveryAddressId }: { employeeId: number; roleId: number | null; deliveryAddressId: number | null }) =>
      apiFetch(`/customers/${customerId}/employees/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ roleId, deliveryAddressId }),
      }),
    onSuccess: async (_data, variables) => {
      await refetchEmployees();
      setEmployeeEdits(previous => {
        const next = { ...previous };
        delete next[variables.employeeId];
        return next;
      });
      toast({ title: "Employee details saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save employee details", description: error.message, variant: "destructive" }),
  });

  // ── Wardrobe bulk price-break prompt ──────────────────────────────────────
  type WardrobePBSuggestion = {
    wiId: number; productName: string; colour: string | null;
    totalQty: number; tierQty: number; currentPrice: number; breakPrice: number;
  };
  type WardrobePBDialog = {
    suggestions: WardrobePBSuggestion[];
    lines: Array<{ wi: any; size: string | null; qty: number }>;
    recipientCtx: { isPersonRecipient: boolean; recipientName: string; recipientEmployeeId: number | null };
    applySet: Set<number>;
  };
  const [wardrobePBDialog, setWardrobePBDialog] = useState<WardrobePBDialog | null>(null);

  const [isSendToProductionOpen, setIsSendToProductionOpen] = useState(false);
  const [productionNotes, setProductionNotes] = useState("");

  // ── Return to stock ───────────────────────────────────────────────────────
  interface ReturnSelection { selected: boolean; quantity: number; type: "plain" | "finished"; unitPrice: string; }
  const [returnToStockOpen, setReturnToStockOpen] = useState(false);
  const [returnSelections, setReturnSelections] = useState<Record<number, ReturnSelection>>({});

  // ── Price-break prompt ────────────────────────────────────────────────────
  const [priceBreakPrompt, setPriceBreakPrompt] = useState<{
    productId: number;
    productName: string;
    lineCount: number;
    oldPrice: number;
    newPrice: number;
    tierQty: number;
    totalQty: number;
  } | null>(null);
  const priceBreakPromptRef = useRef(priceBreakPrompt);
  useEffect(() => { priceBreakPromptRef.current = priceBreakPrompt; }, [priceBreakPrompt]);
  const promptedOnLoadRef = useRef<Set<number>>(new Set());

  // ── Actor name (who is using the system) ──────────────────────────────────
  const [actorName, setActorName] = useState<string>(() => getStoredActor());
  const [actorEditing, setActorEditing] = useState(false);
  const [actorDraft, setActorDraft] = useState("");
  const saveActorName = () => {
    const trimmed = actorDraft.trim();
    localStorage.setItem("sbs_actor_name", trimmed);
    setActorName(trimmed);
    setActorEditing(false);
  };

  interface OrderLog { id: number; orderId: number; action: string; actor: string; details: string | null; createdAt: string; }
  const { data: orderLogs = [], refetch: refetchLogs } = useQuery<OrderLog[]>({
    queryKey: ["order-logs", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/logs`),
    enabled: orderId > 0,
    refetchInterval: 15_000,
  });

  interface OrderEmailLog { id: number; orderId: number; emailType: string; toEmail: string; subject: string | null; sentBy: string | null; sentAt: string; success: boolean; error: string | null; }
  const { data: emailLogs = [], refetch: refetchEmailLogs } = useQuery<OrderEmailLog[]>({
    queryKey: ["order-email-logs", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/email-logs`),
    enabled: orderId > 0,
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [deleteOrderConfirmOpen, setDeleteOrderConfirmOpen] = useState(false);

  const [editingDeliveryAddress, setEditingDeliveryAddress] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("none");
  const [editingInvoiceAddress, setEditingInvoiceAddress] = useState(false);
  const [selectedInvoiceAddressId, setSelectedInvoiceAddressId] = useState<string>("none");

  // Initialise local dropdown value whenever the edit panel opens
  useEffect(() => {
    if (editingDeliveryAddress) {
      setSelectedAddressId((order as any)?.deliveryAddressId?.toString() ?? "none");
    }
  }, [editingDeliveryAddress]);

  useEffect(() => {
    if (editingInvoiceAddress) {
      setSelectedInvoiceAddressId((order as any)?.invoiceAddressId?.toString() ?? "none");
    }
  }, [editingInvoiceAddress]);

  const updateInvoiceAddressMutation = useMutation({
    mutationFn: (addressId: number | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ invoiceAddressId: addressId }) }),
    onMutate: (addressId) => {
      queryClient.setQueryData(getGetOrderQueryKey(orderId), (old: any) =>
        old ? { ...old, invoiceAddressId: addressId } : old
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Invoice address updated" });
      setEditingInvoiceAddress(false);
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Error saving invoice address", description: e.message, variant: "destructive" });
    },
  });

  const updateDeliveryAddressMutation = useMutation({
    mutationFn: (addressId: number | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ deliveryAddressId: addressId }) }),
    onMutate: (addressId) => {
      const selectedAddr = customerDeliveryAddresses?.find(a => a.id === addressId) ?? null;
      queryClient.setQueryData(getGetOrderQueryKey(orderId), (old: any) =>
        old ? { ...old, deliveryAddressId: addressId, deliveryAddress: selectedAddr } : old
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Delivery address updated" });
      setEditingDeliveryAddress(false);
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Error saving delivery address", description: e.message, variant: "destructive" });
    },
  });

  // Check on load: if any product total already qualifies for a better break price, prompt once
  useEffect(() => {
    if (!order?.items || !products) return;
    const byProduct: Record<number, { items: any[]; product: any }> = {};
    for (const oi of (order.items as any[])) {
      if (!oi.productId || oi.isBundleHeader || oi.bundleRef) continue;
      const prod = products.find((p: any) => p.id === oi.productId);
      if (!prod) continue;
      const breaks = Array.isArray((prod as any).priceBreaks) ? (prod as any).priceBreaks as { qty: number; price: number }[] : [];
      if (!breaks.length) continue;
      if (!byProduct[oi.productId]) byProduct[oi.productId] = { items: [], product: prod };
      byProduct[oi.productId].items.push(oi);
    }
    for (const [productIdStr, { items, product }] of Object.entries(byProduct)) {
      const productId = parseInt(productIdStr);
      if (promptedOnLoadRef.current.has(productId)) continue;
      const breaks = ((product as any).priceBreaks as { qty: number; price: number }[])
        .map(b => ({ qty: Number(b.qty), price: parseFloat(String(b.price)) }))
        .filter(b => !isNaN(b.price))
        .sort((a, b) => a.qty - b.qty);
      const totalQty = items.reduce((s: number, oi: any) => s + (Number(oi.quantity) || 0), 0);
      const applicableBreakPrice = getBreakPrice(breaks, totalQty);
      if (applicableBreakPrice === null) continue;
      const currentPrice = parseFloat(String(items[0].unitPrice));
      if (isNaN(currentPrice) || applicableBreakPrice >= currentPrice) continue;
      if (Math.abs(currentPrice - applicableBreakPrice) < 0.005) continue;
      const tier = breaks.filter(b => b.qty <= totalQty).pop()!;
      promptedOnLoadRef.current.add(productId);
      setPriceBreakPrompt({
        productId,
        productName: (product as any).name,
        lineCount: items.length,
        oldPrice: currentPrice,
        newPrice: applicableBreakPrice,
        tierQty: tier.qty,
        totalQty,
      });
      break;
    }
  }, [order?.items, products]);

  // Auto-set delivery address when order has none but customer has addresses
  useEffect(() => {
    if (!order || (order as any).deliveryAddressId || !customerDeliveryAddresses?.length) return;
    const def = customerDeliveryAddresses.find((a: any) => a.isDefault) ?? customerDeliveryAddresses[0];
    if (def) {
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ deliveryAddressId: def.id }) })
        .then(() => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }))
        .catch((err: Error) => console.error("Auto-set delivery address failed:", err.message));
    }
  }, [(order as any)?.deliveryAddressId, customerDeliveryAddresses?.length]);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  const updateNotesMutation = useMutation({
    mutationFn: (notes: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ notes: notes || null }) }),
    onSuccess: (_data, notes) => {
      queryClient.setQueryData(getGetOrderQueryKey(orderId), (old: any) =>
        old ? { ...old, notes: notes ?? null } : old
      );
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingNotes(false);
      toast({ title: "Notes saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [uploading, setUploading] = useState(false);
  const [editingItemPrice, setEditingItemPrice] = useState<{ id: number; value: string } | null>(null);
  const [editingItemQty, setEditingItemQty] = useState<{ id: number; value: string } | null>(null);
  const [lineFilter, setLineFilter] = useState("");
  const [lineSort, setLineSort] = useState<{ col: "product" | "finish" | "recipient" | "price" | "qty" | "total"; dir: "asc" | "desc" } | null>(null);

  function toggleSort(col: typeof lineSort extends null ? never : (typeof lineSort)["col"]) {
    setLineSort(prev =>
      prev?.col === col
        ? prev.dir === "asc" ? { col, dir: "desc" } : null
        : { col, dir: "asc" }
    );
  }

  const filteredItems = (() => {
    const allItems: any[] = (order as any)?.items ?? [];
    const q = lineFilter.toLowerCase().trim();
    let result = q
      ? allItems.filter((oi: any) =>
          oi.productName?.toLowerCase().includes(q) ||
          oi.productSku?.toLowerCase().includes(q) ||
          oi.recipientName?.toLowerCase().includes(q) ||
          oi.colour?.toLowerCase().includes(q) ||
          oi.size?.toLowerCase().includes(q)
        )
      : allItems;

    if (lineSort) {
      result = [...result].sort((a, b) => {
        let av: any, bv: any;
        switch (lineSort.col) {
          case "product":  av = (a.productName ?? "").toLowerCase(); bv = (b.productName ?? "").toLowerCase(); break;
          case "finish":   av = (a.finishName ?? "").toLowerCase(); bv = (b.finishName ?? "").toLowerCase(); break;
          case "recipient":av = (a.recipientName ?? "").toLowerCase(); bv = (b.recipientName ?? "").toLowerCase(); break;
          case "price":    av = a.unitPrice ?? 0; bv = b.unitPrice ?? 0; break;
          case "qty":      av = a.quantity ?? 0; bv = b.quantity ?? 0; break;
          case "total":    av = a.lineTotal ?? 0; bv = b.lineTotal ?? 0; break;
        }
        if (av < bv) return lineSort.dir === "asc" ? -1 : 1;
        if (av > bv) return lineSort.dir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  })();

  const updateItemPriceMutation = useMutation({
    mutationFn: ({ itemId, unitPrice }: { itemId: number; unitPrice: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ unitPrice }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingItemPrice(null);
    },
    onError: (e: Error) => toast({ title: "Failed to update price", description: e.message, variant: "destructive" }),
  });

  const updateItemQtyMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ quantity }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingItemQty(null);
    },
    onError: (e: Error) => toast({ title: "Failed to update quantity", description: e.message, variant: "destructive" }),
  });

  const updateItemVatRateMutation = useMutation({
    mutationFn: ({ itemId, vatRate }: { itemId: number; vatRate: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ vatRate }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }),
    onError: (e: Error) => toast({ title: "Failed to update VAT rate", description: e.message, variant: "destructive" }),
  });

  // ── Bulk price update (applies to all currently-filtered items) ───────────────
  const [bulkPriceInput, setBulkPriceInput] = useState("");
  const [bulkPricePending, setBulkPricePending] = useState(false);
  const applyBulkPrice = async (items: any[]) => {
    const v = parseFloat(bulkPriceInput);
    if (isNaN(v) || v < 0) return;
    setBulkPricePending(true);
    try {
      await Promise.all(
        items.map((oi: any) =>
          apiFetch(`/orders/${orderId}/items/${oi.id}`, { method: "PATCH", body: JSON.stringify({ unitPrice: v }) })
        )
      );
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: `Price updated to £${v.toFixed(2)} on ${items.length} line${items.length !== 1 ? "s" : ""}` });
      setBulkPriceInput("");
    } catch (e: any) {
      toast({ title: "Bulk price update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkPricePending(false);
    }
  };

  const [editingSizeColour, setEditingSizeColour] = useState<{ itemId: number; size: string; colour: string } | null>(null);
  const updateItemSizeColourMutation = useMutation({
    mutationFn: ({ itemId, size, colour }: { itemId: number; size: string; colour: string }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ size: size || null, colour: colour || null }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }); setEditingSizeColour(null); },
    onError: (e: Error) => toast({ title: "Failed to update size/colour", description: e.message, variant: "destructive" }),
  });

  const [editingItemNotes, setEditingItemNotes] = useState<{ id: number; value: string } | null>(null);
  const [deletingItem, setDeletingItem] = useState<{
    itemId: number;
    poInfo: Array<{ poNumber: string; status: string; poId: number }>;
  } | null>(null);
  const updateItemNotesMutation = useMutation({
    mutationFn: ({ itemId, notes }: { itemId: number; notes: string | null }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ notes }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }); setEditingItemNotes(null); },
    onError: (e: Error) => toast({ title: "Failed to update item notes", description: e.message, variant: "destructive" }),
  });

  const updateAttachmentsMutation = useMutation({
    mutationFn: (attachments: Array<{ name: string; objectPath: string }>) =>
      apiFetch(`/orders/${orderId}/attachments`, { method: "PATCH", body: JSON.stringify({ attachments }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }),
    onError: (e: Error) => toast({ title: "Error saving attachments", description: e.message, variant: "destructive" }),
  });

  const requeueForPurchaseMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/purchasing/requeue-items", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Re-queued for purchase", description: "The item will appear in Purchasing on the next refresh." });
    },
    onError: () => toast({ title: "Failed to re-queue", variant: "destructive" }),
  });

  const [editingItemFinish, setEditingItemFinish] = useState<number | null>(null);
  const resetItemToProductionMutation = useMutation({
    mutationFn: ({ itemId, finishId, finishName }: { itemId: number; finishId: number | null; finishName: string | null }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ finishId, finishName, stockStatus: "allocated" }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingItemFinish(null);
      toast({ title: "Item reset to production", description: vars.finishName ? `Finish set to "${vars.finishName}". Item will reappear in the production queue.` : "Item returned to the production queue." });
    },
    onError: (e: Error) => toast({ title: "Failed to reset item", description: e.message, variant: "destructive" }),
  });

  const [editingBackorderDate, setEditingBackorderDate] = useState<{ id: number; poId: number; date: string } | null>(null);
  const updateBackorderDateMutation = useMutation({
    mutationFn: ({ id, poId, date }: { id: number; poId: number; date: string }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ estimatedDueDate: date || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-backorders", orderId] });
      setEditingBackorderDate(null);
      toast({ title: "Due date updated" });
    },
    onError: () => toast({ title: "Failed to update due date", variant: "destructive" }),
  });

  const currentAttachments: Array<{ name: string; objectPath: string }> =
    Array.isArray((order as any)?.attachments) ? (order as any).attachments : [];

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const added: Array<{ name: string; objectPath: string }> = [];
      for (const file of files) {
        const meta = await apiFetch<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        await fetch(meta.uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        added.push({ name: file.name, objectPath: meta.objectPath });
      }
      await updateAttachmentsMutation.mutateAsync([...currentAttachments, ...added]);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload file. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    uploadFiles(files);
  };

  const removeAttachment = (idx: number) => {
    updateAttachmentsMutation.mutate(currentAttachments.filter((_, i) => i !== idx));
  };

  const [editingRequiredDate, setEditingRequiredDate] = useState(false);
  const [requiredDateValue, setRequiredDateValue] = useState("");

  const updateRequiredDateMutation = useMutation({
    mutationFn: (date: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ requiredDate: date || null }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingRequiredDate(false);
      toast({ title: "Required date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const SHIPPING_OPTIONS = [
    { value: "local_delivery", label: "Local Delivery" },
    { value: "office_collection", label: "Office Collection" },
    { value: "warehouse_collection", label: "Warehouse Collection" },
    { value: "courier", label: "Courier" },
  ];

  const [editingShippingMethod, setEditingShippingMethod] = useState(false);
  const [dpdRetryOpen, setDpdRetryOpen] = useState(false);
  const [dpdRetryParcels, setDpdRetryParcels] = useState(1);
  const [dpdRetryWeight, setDpdRetryWeight] = useState<number | "">("");

  const DPD_METHODS = new Set(["dpd", "dpd_next_day", "courier"]);

  const retryDpdMutation = useMutation({
    mutationFn: () => apiFetch<{ consignmentNumber: string; trackingUrl: string; labelHtml: string | null }>(
      `/dispatch/orders/${orderId}/retry-dpd`,
      { method: "POST", body: JSON.stringify({ numberOfParcels: dpdRetryParcels, totalWeightKg: dpdRetryWeight }) }
    ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setDpdRetryOpen(false);
      toast({ title: "DPD booked", description: `Consignment: ${data.consignmentNumber}` });
      if (data.labelHtml) setTimeout(() => printDpdLabelHtml(data.labelHtml!), 300);
    },
    onError: (e: Error) => toast({ title: "DPD booking failed", description: e.message, variant: "destructive" }),
  });

  const updateShippingMethodMutation = useMutation({
    mutationFn: (method: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ shippingMethod: method }) }),
    onSuccess: (_data, method) => {
      // Auto-default carriage to £8.50 when switching to a courier method with no carriage set
      const currentCarriage = parseFloat(String((order as any)?.carriageAmount ?? "0"));
      if (DPD_METHODS.has(method ?? "") && currentCarriage === 0) {
        apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ carriageAmount: 8.50 }) })
          .then(() => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }))
          .catch(() => {});
      } else {
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      }
      setEditingShippingMethod(false);
      toast({ title: "Shipping method updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editingCarriage, setEditingCarriage] = useState(false);
  const [carriageInput, setCarriageInput] = useState("");

  const updateCarriageMutation = useMutation({
    mutationFn: (amount: number) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ carriageAmount: amount }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingCarriage(false);
      toast({ title: "Carriage updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editingBoxes, setEditingBoxes] = useState(false);
  const [boxesInput, setBoxesInput] = useState("");

  const updateBoxesMutation = useMutation({
    mutationFn: (n: number) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ numberOfBoxes: n }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingBoxes(false);
      toast({ title: "Box count updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  interface PackItem { orderItemId: number; productName: string; colour: string | null; size: string | null; quantity: number; isComplete: boolean; worksheetNumber: string | null; }
  interface PackRecipient { recipientType: "stock" | "person"; recipientName: string | null; employeeId: number | null; jobTitle: string | null; department: string | null; allComplete: boolean; items: PackItem[]; }
  interface PackStatus { orderId: number; orderNumber: string; customerName: string | null; recipients: PackRecipient[]; }

  interface OrderBackorderLine { id: number; poId: number; poNumber: string; supplierName: string; productName: string; colour: string | null; size: string | null; supplierCode: string | null; quantityOrdered: number; quantityDelivered: number; remaining: number; estimatedDueDate: string | null; orderItemId: number | null; }

  const { data: packStatus, refetch: refetchPackStatus } = useQuery<PackStatus>({
    queryKey: ["pack-status", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/pack-status`),
    enabled: orderId > 0,
  });

  const { data: orderBackorders = [] } = useQuery<OrderBackorderLine[]>({
    queryKey: ["order-backorders", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/backorders`),
    enabled: orderId > 0,
    refetchInterval: 15_000,
  });

  interface ConsolidationCandidate { id: number; orderNumber: string; status: string; totalAmount: string | null; poNumber: string | null; itemCount: number; }
  const { data: consolidationCandidates = [] } = useQuery<ConsolidationCandidate[]>({
    queryKey: ["consolidation-candidates", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/consolidation-candidates`),
    enabled: orderId > 0,
  });

  const printLabel = (recipient: PackRecipient, itemsToPrint?: PackItem[]) => {
    const win = window.open("", "_blank", "width=600,height=900");
    if (!win) return;
    const printItems = itemsToPrint ?? recipient.items;
    const lines = printItems.map(i => `<tr><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px">${i.productName}</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px;color:#555">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px;text-align:center;font-weight:bold">${i.quantity}</td></tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Pack Label — ${recipient.recipientName}</title>
      <style>
        @page { size: 4in 6in; margin: 0; }
        body { margin: 0; font-family: Arial, sans-serif; width: 4in; height: 6in; display: flex; flex-direction: column; box-sizing: border-box; padding: 0; }
        * { box-sizing: border-box; }
      </style>
    </head><body>
      <div style="background:#1e3a5f;color:white;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.8">Your business</div><div style="font-size:11px;font-weight:bold;margin-top:2px">Order: ${order?.orderNumber ?? ""}${(order as any)?.poNumber ? ` &bull; PO: ${(order as any).poNumber}` : ""}</div></div>
        <div style="font-size:10px;opacity:.7;text-align:right">${order?.customerName ?? ""}</div>
      </div>
      <div style="padding:14px;background:#f0f4fa;border-bottom:2px solid #1e3a5f">
        <div style="font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1">${recipient.recipientName}</div>
        ${recipient.jobTitle ? `<div style="font-size:13px;color:#444;margin-top:3px">${recipient.jobTitle}</div>` : ""}
        ${recipient.department ? `<div style="font-size:11px;color:#888">${recipient.department}</div>` : ""}
      </div>
      <div style="padding:10px 14px;flex:1">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px">Pack Contents</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#e8edf5">
            <th style="padding:4px 6px;text-align:left;font-size:11px;color:#555">Product</th>
            <th style="padding:4px 6px;text-align:left;font-size:11px;color:#555">Variant</th>
            <th style="padding:4px 6px;text-align:center;font-size:11px;color:#555">Qty</th>
          </tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </div>
      <div style="padding:10px 14px;border-top:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:9px;color:#aaa">Packed by:</div>
        <div style="width:100px;border-bottom:1px solid #ccc;height:16px"></div>
        <div style="font-size:9px;color:#aaa">Date:</div>
        <div style="width:70px;border-bottom:1px solid #ccc;height:16px"></div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const printOrderNotes = () => {
    const win = window.open("", "_blank", "width=600,height=800");
    if (!win) return;
    const escapeHtml = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const notesText = escapeHtml(order.notes ?? "");
    const itemNotes = ((order as any).items ?? [])
      .filter((item: any) => item.notes?.trim())
      .map((item: any) => {
        const label = [item.productName, item.recipientName].filter(Boolean).join(" — ");
        return `<div style="margin-top:10px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px">
          <div style="font-size:11px;font-weight:bold;color:#92400e;margin-bottom:4px">${escapeHtml(label || "Order line")}</div>
          <div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(item.notes)}</div>
        </div>`;
      })
      .join("");
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Notes — Order ${order?.orderNumber ?? ""}</title>
      <style>
        @page { margin: 0.6in; }
        body { margin: 0; font-family: Arial, sans-serif; color: #1a1a1a; }
        * { box-sizing: border-box; }
      </style>
    </head><body>
      <div style="border-bottom:2px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#1e3a5f;font-weight:bold">Your business</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:6px">
          <div>
            <div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1.15">${order?.customerName ?? ""}</div>
            <div style="font-size:13px;color:#555;margin-top:2px"><strong>Order:</strong> ${order?.orderNumber ?? ""}${(order as any)?.poNumber ? ` &bull; PO: ${(order as any).poNumber}` : ""}</div>
          </div>
          <div style="font-size:16px;font-weight:bold;color:#1e3a5f">Order Notes</div>
        </div>
      </div>
      <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;padding:14px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;min-height:100px">${notesText || '<em style="color:#999">No general notes for this order.</em>'}</div>
      ${itemNotes ? `<div style="font-size:12px;font-weight:bold;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-top:18px">Line item notes</div>${itemNotes}` : ""}
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const [sendAckOpen, setSendAckOpen] = useState(false);

  const sendToProductionMutation = useMutation({
    mutationFn: async (itemIds: number[]) => {
      return apiFetch("/worksheets", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customerName: order.customerName,
          notes: productionNotes || null,
          itemIds,
        }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["pack-status", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-logs", orderId] });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      if (data.worksheetNumber) {
        toast({ title: `Worksheet ${data.worksheetNumber} created`, description: "Order added to Pre-Production." });
      } else {
        toast({ title: "Items marked as complete", description: "No decoration needed — items moved straight to dispatch." });
      }
      setIsSendToProductionOpen(false);
      setProductionNotes("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const confirmPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order confirmed", description: "Order moved to draft — ready to process." });
      navigate("/orders");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/reject`, { method: "POST", body: JSON.stringify({ reason: "" }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order rejected", description: "Order has been cancelled." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unconfirmPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/unconfirm`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order unconfirmed", description: "Order returned to portal pending — ready to review again." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: productAttributes } = useProductAttributes(item.productId);
  const { data: productVariants } = useProductVariants(item.productId);

  const colours = [...new Set((productAttributes ?? []).filter(a => a.type === "colour").map(a => a.value))];
  const sizes = sortSizesWithOrder([...new Set((productAttributes ?? []).filter(a => a.type === "size").map(a => a.value))], sizeOrder);

  useEffect(() => {
    // Skip variant price lookup for wardrobe items — they use the customer's special/wardrobe price
    if (item.fromWardrobe) return;
    if (item.productId && productVariants) {
      const match = productVariants.find(v => v.colour === item.colour && v.size === item.size);
      if (match?.price != null) {
        const base = match.price!.toString();
        const total = (match.price! + item.finishCost).toString();
        setItem(i => ({ ...i, baseUnitPrice: base, unitPrice: total }));
      }
    }
  }, [item.colour, item.size, item.productId, item.fromWardrobe, productVariants]);

  // Fetch last-ordered sizes from order history when an employee is selected
  useEffect(() => {
    if (!selectedEmployee || !customerId) {
      setLastOrderedSizes({ byProductId: {}, byProductName: {} });
      return;
    }
    apiFetch<{ byProductId: Record<string, any>; byProductName: Record<string, any> }>(
      `/customers/${customerId}/employees/${selectedEmployee.id}/last-sizes`
    ).then(setLastOrderedSizes).catch(() => {});
  }, [selectedEmployee?.id, customerId]);

  // Auto-suggest size when employee + product are both selected (order history takes priority over profile)
  useEffect(() => {
    if (!selectedEmployee || !item.productName || item.size) return;
    // 1. Check order history by product ID
    const byId = item.productId ? lastOrderedSizes.byProductId[item.productId] : null;
    if (byId?.size) { setItem(i => ({ ...i, size: byId.size })); return; }
    // 2. Check order history by product name
    const byName = lastOrderedSizes.byProductName[item.productName];
    if (byName?.size) { setItem(i => ({ ...i, size: byName.size })); return; }
    // 3. Fall back to manually saved profile sizes
    const savedSize = selectedEmployee.sizes?.find(s => s.label === item.productName);
    if (savedSize) setItem(i => ({ ...i, size: savedSize.size }));
  }, [selectedEmployee?.id, item.productName, item.productId, lastOrderedSizes]);

  // Auto-update unit price when total quantity changes for products with price breaks
  useEffect(() => {
    if (item.fromWardrobe || !item.productId) return;
    const prod = products?.find(p => p.id === item.productId);
    if (!prod) return;
    const priceBreaks = (prod as any).priceBreaks as { qty: number; price: number }[] | null;
    if (!priceBreaks || priceBreaks.length === 0) return;
    const totalQty = sizes.length > 0
      ? sizeRows.reduce((s, r) => s + (r.qty || 0), 0)
      : item.quantity;
    const tierPrice = getBreakPrice(priceBreaks, totalQty);
    const newPrice = tierPrice !== null ? tierPrice.toFixed(2) : prod.unitPrice.toString();
    setItem(i => ({ ...i, unitPrice: newPrice, baseUnitPrice: newPrice }));
  }, [sizeRows, item.quantity, item.productId, item.fromWardrobe, products]);

  const handleProductSelect = (productId: number) => {
    const prod = products?.find(p => p.id === productId);
    if (!prod) return;
    const priceBreaks = (prod as any).priceBreaks as { qty: number; price: number }[] | null;
    const initialPrice = (priceBreaks && priceBreaks.length > 0)
      ? (getBreakPrice(priceBreaks, 1) ?? prod.unitPrice).toString()
      : prod.unitPrice.toString();
    const prodVatRate = typeof (prod as any).vatRate === "number" ? (prod as any).vatRate : parseFloat(String((prod as any).vatRate ?? 0.20));
    setItem({ ...EMPTY_ITEM, productId: prod.id, productName: prod.name, unitPrice: initialPrice, baseUnitPrice: initialPrice, vatRate: isNaN(prodVatRate) ? 0.20 : prodVatRate });
    setSizeRows([{ size: "", qty: 1 }]);
    setProductSearchOpen(false);
  };

  const handleFinishSelect = (value: string) => {
    if (value === "plain") {
      const base = item.baseUnitPrice || item.unitPrice;
      setItem(i => ({ ...i, finishId: null, finishName: null, finishCost: 0, unitPrice: base, baseUnitPrice: base }));
    } else {
      const finish = customerFinishes?.find(f => f.id.toString() === value);
      if (finish) {
        // Check for an agreed price on this product+finish combination first
        const agreedItem = (customerFinishedItems ?? []).find(
          fi => fi.productId === item.productId && fi.finishId === finish.id
        );
        if (agreedItem) {
          // Use the agreed all-in price (specialPrice overrides everything; unitPrice is the garment base)
          const agreedPrice = agreedItem.specialPrice != null
            ? agreedItem.specialPrice
            : agreedItem.unitPrice;
          setItem(i => ({ ...i, finishId: finish.id, finishName: finish.name, finishCost: 0, unitPrice: agreedPrice.toFixed(2) }));
        } else {
          // The garment price includes one standard £4 main logo. Only additional logos are extra.
          const extraCost = getAdditionalLogoCost(finish.processes ?? []);
          const base = parseFloat(item.baseUnitPrice || item.unitPrice) || 0;
          const total = base + extraCost;
          setItem(i => ({ ...i, finishId: finish.id, finishName: finish.name, finishCost: extraCost, unitPrice: total.toFixed(2) }));
        }
      }
    }
  };

  const handleEmployeeSelect = (value: string) => {
    if (value === "__new__") {
      setSelectedEmployee(null);
      setIsNewPerson(true);
      setItem(i => ({ ...i, recipientName: "" }));
    } else {
      const emp = customerEmployees?.find(e => e.id.toString() === value);
      if (emp) {
        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        setSelectedEmployee(emp);
        setIsNewPerson(false);
        setItem(i => ({ ...i, recipientName: name, recipientEmployeeId: emp.id }));
      }
    }
  };

  const resetDialog = () => {
    setItem({ ...EMPTY_ITEM });
    setSizeRows([{ size: "", qty: 1 }]);
    setSelectedEmployee(null);
    setIsNewPerson(false);
    setIsAddItemOpen(false);
    setDialogTab("wardrobe");
    setWardrobeRecipient(null);
    setWardrobeItemSizes({});
    setWardrobeItemQtys({});
    setEmpSearch("");
    setAddRecipientOpen(false);
    setAddRecipientForm({ firstName: "", lastName: "", jobTitle: "" });
    setServiceProductSearchOpen(false);
  };

  // Select a person (or stock) in the wardrobe tab — fetches last sizes and pre-fills
  const handleWardrobePersonSelect = async (recipient: "stock" | CustomerEmployee) => {
    setWardrobeRecipient(recipient);
    setWardrobeItemSizes({});
    setWardrobeItemSleeves({});
    setWardrobeItemQtys({});
    setWardrobeBulkModes({});
    setWardrobeBulkQtys({});
    if (recipient === "stock" || !customerId || typeof recipient === "string") return;
    try {
      const lastSizes = await apiFetch<{
        byProductId: Record<string, { size: string; colour: string | null }>;
        byProductName: Record<string, { size: string; colour: string | null }>;
      }>(`/customers/${customerId}/employees/${recipient.id}/last-sizes`);

      const newSizes: Record<number, string> = {};
      for (const fi of (customerFinishedItems ?? [])) {
        const byId = fi.productId ? lastSizes.byProductId[String(fi.productId)]?.size : null;
        const byName = lastSizes.byProductName[fi.productName ?? fi.name]?.size;
        const saved = recipient.sizes?.find(s => s.label === (fi.productName ?? fi.name))?.size;
        const pre = byId ?? byName ?? saved ?? fi.size ?? "";
        if (pre) newSizes[fi.id] = pre;
      }
      setWardrobeItemSizes(newSizes);
    } catch { /* size pre-fill is best-effort */ }
  };

  // The garment price includes one standard £4 main logo. All other logo processes are additive.
  const getFiFinishExtra = (fi: CustomerFinishedItem): number => {
    if (fi.specialPrice != null || fi.finishId == null) return 0;
    const finish = customerFinishes?.find(f => f.id === fi.finishId);
    if (!finish || !finish.processes?.length) return 0;
    return getAdditionalLogoCost(finish.processes);
  };

  // Same for wi (wardrobeData item) objects using wardrobeData.processes.
  const getWiFinishExtra = (wi: any): number => {
    if (wi.special_price != null || wi.finish_id == null) return 0;
    const procs = (wardrobeData?.processes ?? []).filter((p: any) => Number(p.finish_id) === Number(wi.finish_id));
    return getAdditionalLogoCost(procs);
  };

  // Add a single wardrobe item directly (without closing the dialog so staff can add more)
  const handleWardrobeItemAdd = (fi: CustomerFinishedItem) => {
    const size = wardrobeItemSizes[fi.id] ?? "";
    const qty = wardrobeItemQtys[fi.id] ?? 0;
    // fi.unitPrice already includes extra process costs (set via calcPriceForFinish when wardrobe was configured).
    // Do NOT add getFiFinishExtra() again — that would double-charge for multi-process finishes.
    const effectivePrice = fi.specialPrice != null ? fi.specialPrice : fi.unitPrice;
    const isPersonRecipient = wardrobeRecipient !== null && wardrobeRecipient !== "stock";
    const recipientName = isPersonRecipient
      ? [(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")
      : "";
    const recipientEmployeeId = isPersonRecipient ? (wardrobeRecipient as CustomerEmployee).id : null;

    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: fi.productId,
          productName: fi.productName ?? fi.name,
          colour: fi.colour ?? null,
          size: size || null,
          finishId: fi.finishId ?? null,
          finishName: fi.finishName ?? null,
          recipientType: isPersonRecipient ? "person" : "stock",
          recipientName: isPersonRecipient ? recipientName : null,
          recipientEmployeeId: isPersonRecipient ? recipientEmployeeId : null,
          quantity: qty,
          unitPrice: effectivePrice,
        } as Parameters<typeof addItemMutation.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Added", description: `${fi.productName ?? fi.name} added to the order.` });
          // Reset qty for this item only; keep size so same person's next line is fast
          setWardrobeItemQtys(s => { const n = { ...s }; delete n[fi.id]; return n; });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  // Add a single wardrobe item using new rich wardrobe-data format
  const handleWardrobeWiAdd = (wi: any) => {
    const id = wi.id as number;
    const waist = wardrobeItemSizes[id] ?? "";
    const sleeve = wardrobeItemSleeves[id] ?? "";
    const sleeveOpts = wardrobeData?.sleevesMap?.[String(wi.product_id)] ?? [];
    const sizeOpts = (() => {
      if (!wardrobeData?.sizesMap) return [] as string[];
      const byColour = wardrobeData.sizesMap[String(wi.product_id)];
      if (!byColour) return [] as string[];
      return [...new Set(Object.values(byColour).flat())] as string[];
    })();
    const effectiveSize = sizeOpts.length === 0
      ? ""
      : sleeveOpts.length > 0 && sleeve ? `${waist}/${sleeve}` : waist;
    const qty = wardrobeItemQtys[id] ?? 0;
    // Always use the current product price + decoration extras so the order reflects today's price,
    // not the stale price baked into cfi.unit_price when the wardrobe item was first created.
    // Fall back to the stored unit_price only when no product price is available.
    const effectivePrice = wi.special_price != null
      ? parseFloat(String(wi.special_price))
      : wi.product_unit_price != null
        ? parseFloat(String(wi.product_unit_price)) + getWiFinishExtra(wi)
        : parseFloat(String(wi.unit_price ?? "0"));
    const isPersonRecipient = wardrobeRecipient !== null && wardrobeRecipient !== "stock";
    const recipientName = isPersonRecipient
      ? [(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")
      : "";
    const recipientEmployeeId = isPersonRecipient ? (wardrobeRecipient as CustomerEmployee).id : null;
    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: wi.product_id,
          productName: wi.product_name ?? wi.name,
          colour: wi.colour ?? null,
          size: effectiveSize || null,
          finishId: wi.finish_id ?? null,
          finishName: wi.finish_name ?? null,
          recipientType: isPersonRecipient ? "person" : "stock",
          recipientName: isPersonRecipient ? recipientName : null,
          recipientEmployeeId: isPersonRecipient ? recipientEmployeeId : null,
          quantity: qty,
          unitPrice: effectivePrice,
        } as Parameters<typeof addItemMutation.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Added", description: `${wi.product_name ?? wi.name} added to the order.` });
          setWardrobeItemQtys(s => { const n = { ...s }; delete n[id]; return n; });
          setWardrobeItemSleeves(s => { const n = { ...s }; delete n[id]; return n; });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  // Add multiple wardrobe items in bulk (one line per size with qty > 0)
  const handleWardrobeBulkAdd = async (wi: any, comboOptions: string[]) => {
    const id = wi.id as number;
    const qtys = wardrobeBulkQtys[id] ?? {};
    const sizesWithQty = comboOptions.filter(s => (qtys[s] ?? 0) > 0);
    if (sizesWithQty.length === 0) return;
    // Always use the current product price + decoration extras so the order reflects today's price,
    // not the stale price baked into cfi.unit_price when the wardrobe item was first created.
    const effectivePrice = wi.special_price != null
      ? parseFloat(String(wi.special_price))
      : wi.product_unit_price != null
        ? parseFloat(String(wi.product_unit_price)) + getWiFinishExtra(wi)
        : parseFloat(String(wi.unit_price ?? "0"));
    const isPersonRecipient = wardrobeRecipient !== null && wardrobeRecipient !== "stock";
    const recipientName = isPersonRecipient
      ? [(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")
      : "";
    const recipientEmployeeId = isPersonRecipient ? (wardrobeRecipient as CustomerEmployee).id : null;
    try {
      await Promise.all(sizesWithQty.map(size =>
        apiFetch(`/orders/${orderId}/items`, {
          method: "POST",
          body: JSON.stringify({
            productId: wi.product_id,
            productName: wi.product_name ?? wi.name,
            colour: wi.colour ?? null,
            size,
            finishId: wi.finish_id ?? null,
            finishName: wi.finish_name ?? null,
            recipientType: isPersonRecipient ? "person" : "stock",
            recipientName: isPersonRecipient ? recipientName : null,
            recipientEmployeeId,
            quantity: qtys[size],
            unitPrice: effectivePrice,
          }),
        })
      ));
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: `${sizesWithQty.length} line${sizesWithQty.length !== 1 ? "s" : ""} added to order` });
      setWardrobeBulkQtys(q => { const n = { ...q }; delete n[id]; return n; });
      setWardrobeBulkModes(m => ({ ...m, [id]: false }));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // ── Post wardrobe lines (shared by direct-add and price-break dialog confirm) ──
  const doPostWardrobeLines = async (
    lines: Array<{ wi: any; size: string | null; qty: number }>,
    recipientCtx: { isPersonRecipient: boolean; recipientName: string; recipientEmployeeId: number | null },
    priceOverrides: Map<number, number>,
  ) => {
    setIsAddingMulti(true);
    try {
      await Promise.all(lines.map(({ wi, size, qty }) => {
        const basePrice = wi.special_price != null
          ? parseFloat(String(wi.special_price))
          : wi.product_unit_price != null
            ? parseFloat(String(wi.product_unit_price)) + getWiFinishExtra(wi)
            : parseFloat(String(wi.unit_price ?? "0"));
        const effectivePrice = priceOverrides.has(wi.id) ? priceOverrides.get(wi.id)! : basePrice;
        return apiFetch(`/orders/${orderId}/items`, {
          method: "POST",
          body: JSON.stringify({
            productId: wi.product_id,
            productName: wi.product_name ?? wi.name,
            colour: wi.colour ?? null,
            size,
            finishId: wi.finish_id ?? null,
            finishName: wi.finish_name ?? null,
            recipientType: recipientCtx.isPersonRecipient ? "person" : "stock",
            recipientName: recipientCtx.isPersonRecipient ? recipientCtx.recipientName : null,
            recipientEmployeeId: recipientCtx.recipientEmployeeId,
            quantity: qty,
            unitPrice: effectivePrice,
          }),
        });
      }));
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Items Added", description: `${lines.length} line${lines.length !== 1 ? "s" : ""} added to order.` });
      resetDialog();
    } catch (err: any) {
      toast({ title: "Error adding items", description: err.message, variant: "destructive" });
    } finally {
      setIsAddingMulti(false);
    }
  };

  // Add ALL currently configured wardrobe items in one shot (used by the bottom "Add to Order" button).
  // Accepts an optional `forRecipient` to support the save-and-add flow where the recipient is
  // freshly created and React state hasn't updated yet.
  const handleWardrobeAddAll = async (forRecipient?: CustomerEmployee | "stock") => {
    const effectiveRecipient = forRecipient ?? wardrobeRecipient;
    if (!wardrobeData) {
      toast({ title: "Wardrobe not loaded", description: "Wardrobe data is still loading — please try again.", variant: "destructive" });
      return;
    }
    if (effectiveRecipient === null) return;
    const wiItems = (wardrobeData.items ?? []).filter((wi: any) =>
      effectiveRecipient === "stock" ||
      wi.effective_role_id === null ||
      wi.effective_role_id === (effectiveRecipient as CustomerEmployee).roleId
    );
    const isPersonRecipient = effectiveRecipient !== "stock";
    const recipientName = isPersonRecipient
      ? [(effectiveRecipient as CustomerEmployee).firstName, (effectiveRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")
      : "";
    const recipientEmployeeId = isPersonRecipient ? (effectiveRecipient as CustomerEmployee).id : null;
    const recipientCtx = { isPersonRecipient, recipientName, recipientEmployeeId };

    type AddLine = { wi: any; size: string | null; qty: number };
    const lines: AddLine[] = [];

    for (const wi of wiItems) {
      const id = wi.id as number;
      const isBulk = wardrobeBulkModes[id] ?? false;
      const sleeveOpts: string[] = (wardrobeData as any).sleevesMap?.[String(wi.product_id)] ?? [];
      const byColour = (wardrobeData as any).sizesMap?.[String(wi.product_id)];
      const sizeOpts: string[] = byColour ? [...new Set(Object.values(byColour).flat() as string[])] : [];
      const oneSize = sizeOpts.length === 0;

      if (isBulk) {
        const qtys = wardrobeBulkQtys[id] ?? {};
        const combos = sleeveOpts.length > 0
          ? sizeOpts.flatMap(s => sleeveOpts.map(sl => `${s}/${sl}`))
          : sizeOpts;
        for (const combo of combos) {
          const qty = qtys[combo] ?? 0;
          if (qty > 0) lines.push({ wi, size: combo, qty });
        }
      } else {
        const waist = wardrobeItemSizes[id] ?? "";
        const sleeve = wardrobeItemSleeves[id] ?? "";
        const size = oneSize ? null : sleeveOpts.length > 0 && sleeve ? `${waist}/${sleeve}` : waist || null;
        const singleQty = wardrobeItemQtys[id] ?? 0;
        if ((oneSize || size) && singleQty > 0) lines.push({ wi, size, qty: singleQty });
      }
    }

    if (lines.length === 0) {
      toast({ title: "Nothing to add", description: "Select a size or enter quantities first.", variant: "destructive" });
      return;
    }

    // ── Check for quantity-discount price breaks ───────────────────────────
    // Aggregate total qty per wardrobe item id, then find the best qualifying tier.
    const qtyByWiId = new Map<number, number>();
    for (const { wi, qty } of lines) qtyByWiId.set(wi.id, (qtyByWiId.get(wi.id) ?? 0) + qty);

    const suggestions: WardrobePBSuggestion[] = [];
    const seenWiIds = new Set<number>();
    for (const { wi } of lines) {
      if (seenWiIds.has(wi.id)) continue;
      seenWiIds.add(wi.id);
      const breaks: { qty: number; price: number }[] | null = wi.price_breaks
        ? (Array.isArray(wi.price_breaks) ? wi.price_breaks : JSON.parse(String(wi.price_breaks)))
        : null;
      if (!breaks || breaks.length === 0) continue;
      const totalQty = qtyByWiId.get(wi.id) ?? 0;
      const currentPrice = wi.special_price != null
        ? parseFloat(String(wi.special_price))
        : parseFloat(String(wi.unit_price ?? "0"));
      // Best qualifying tier: highest qty threshold that totalQty meets, with a lower price
      const qualifying = breaks
        .map(pb => ({ qty: Number(pb.qty), price: parseFloat(String(pb.price)) }))
        .filter(pb => !isNaN(pb.price) && pb.qty <= totalQty && pb.price < currentPrice)
        .sort((a, b) => b.qty - a.qty);
      if (qualifying.length === 0) continue;
      const best = qualifying[0];
      suggestions.push({
        wiId: wi.id,
        productName: wi.product_name ?? wi.name ?? "Item",
        colour: wi.colour ?? null,
        totalQty,
        tierQty: best.qty,
        currentPrice,
        breakPrice: best.price,
      });
    }

    if (suggestions.length > 0) {
      // Show the price-break dialog; posting happens after user confirms
      setWardrobePBDialog({
        suggestions,
        lines,
        recipientCtx,
        applySet: new Set(suggestions.map(s => s.wiId)), // all checked by default
      });
      return;
    }

    // No qualifying breaks — post directly
    await doPostWardrobeLines(lines, recipientCtx, new Map());
  };

  const handleWardrobeSelect = (fi: CustomerFinishedItem) => {
    const finishExtra = getFiFinishExtra(fi);
    // fi.unitPrice already includes extra process costs; subtract finishExtra to derive the garment-only
    // base for the price breakdown display, but don't add it again to effectivePrice.
    const garmentBase = fi.specialPrice != null ? fi.specialPrice : fi.unitPrice - finishExtra;
    const effectivePrice = fi.specialPrice != null ? fi.specialPrice : fi.unitPrice;
    setPriceOverrideEnabled(false);
    setItem({
      ...EMPTY_ITEM,
      productId: fi.productId,
      productName: fi.productName ?? fi.name,
      colour: fi.colour ?? "",
      size: fi.size ?? "",
      finishId: fi.finishId ?? null,
      finishName: fi.finishName ?? null,
      finishCost: finishExtra,
      unitPrice: effectivePrice.toString(),
      baseUnitPrice: garmentBase.toString(),
      fromWardrobe: true,
    });
  };

  const doAddItem = (overrides: Record<string, unknown> = {}) => {
    if (!item.productId || !item.productName) return;
    const price = parseFloat(item.unitPrice);
    if (isNaN(price)) return;
    const addedQty = (overrides.quantity as number) ?? item.quantity;

    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: item.productId,
          productName: item.productName,
          colour: item.colour || null,
          size: item.size || null,
          finishId: item.finishId ?? null,
          finishName: item.finishName ?? null,
          recipientType: item.recipientType,
          recipientName: item.recipientType === "person" ? (item.recipientName || null) : null,
          recipientEmployeeId: item.recipientType === "person" ? (item.recipientEmployeeId ?? null) : null,
          quantity: item.quantity,
          unitPrice: price,
          vatRate: item.vatRate,
          ...overrides,
        } as Parameters<typeof addItemMutation.mutate>[0]["data"]
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          refetchEmployees();
          toast({ title: "Item Added", description: `${item.productName} added to order.` });

          // Price-break prompt
          const prod = products?.find(p => p.id === item.productId);
          const breaks: { qty: number; price: number }[] = Array.isArray((prod as any)?.priceBreaks)
            ? (prod as any).priceBreaks : [];
          if (breaks.length > 0 && item.productId) {
            const existingQty = (order?.items ?? [])
              .filter((oi: any) => oi.productId === item.productId && !oi.isBundleHeader && !oi.bundleRef)
              .reduce((s: number, oi: any) => s + (Number(oi.quantity) || 0), 0);
            const totalQty = existingQty + addedQty;
            const normalised = breaks.map(b => ({ qty: Number(b.qty), price: parseFloat(String(b.price)) })).sort((a, b) => a.qty - b.qty);
            const justUnlocked = normalised.filter(b => b.qty <= totalQty && b.qty > existingQty);
            if (justUnlocked.length > 0) {
              const best = justUnlocked[justUnlocked.length - 1];
              if (best.price < price) {
                const existingLineCount = (order?.items ?? []).filter((oi: any) => oi.productId === item.productId && !oi.isBundleHeader && !oi.bundleRef).length;
                setTimeout(() => setPriceBreakPrompt({
                  productId: item.productId!,
                  productName: item.productName,
                  lineCount: existingLineCount + 1,
                  oldPrice: price,
                  newPrice: best.price,
                  tierQty: best.qty,
                  totalQty,
                }), 300);
              } else {
                const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
                if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
              }
            } else {
              const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
              if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
            }
          }

          resetDialog();
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleAddItem = async () => {
    // Service tab: allow name-only (no catalog productId required)
    if (dialogTab === "service") {
      if (!item.productName.trim()) return;
    } else {
      if (!item.productId || !item.productName) return;
    }
    const price = parseFloat(item.unitPrice);
    if (isNaN(price)) return;

    if (dialogTab === "custom" || dialogTab === "service") {
      const priceOk = await confirmIfNotWhole(price);
      if (!priceOk) return;
    }

    // Custom-tab validations only (wardrobe tab sets colour/size on selection)
    if (dialogTab === "custom") {
      if (colours.length > 0 && !item.colour) {
        toast({ title: "Colour required", description: "Please select a colour before adding to the order.", variant: "destructive" });
        return;
      }
      if (sizes.length > 0) {
        const missingSizes = sizeRows.some(r => !r.size);
        if (missingSizes) {
          toast({ title: "Size required", description: "Please select a size for every row before adding.", variant: "destructive" });
          return;
        }
      }
    }

    // ── Multi-size: add one line per row, no individual stock checks ──
    if (dialogTab === "custom" && sizes.length > 0 && sizeRows.length > 1) {
      setIsAddingMulti(true);
      try {
        for (const row of sizeRows) {
          await apiFetch(`/orders/${orderId}/items`, {
            method: "POST",
            body: JSON.stringify({
              productId: item.productId,
              productName: item.productName,
              colour: item.colour || null,
              size: row.size || null,
              finishId: item.finishId ?? null,
              finishName: item.finishName ?? null,
              recipientType: item.recipientType,
              recipientName: item.recipientType === "person" ? (item.recipientName || null) : null,
              recipientEmployeeId: item.recipientType === "person" ? (item.recipientEmployeeId ?? null) : null,
              quantity: row.qty,
              unitPrice: price,
            }),
          });
        }
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
        refetchEmployees();
        toast({ title: "Items Added", description: `${sizeRows.length} size lines added to order.` });

        // Price-break prompt for multi-size
        const prod = products?.find(p => p.id === item.productId);
        const breaks: { qty: number; price: number }[] = Array.isArray((prod as any)?.priceBreaks)
          ? (prod as any).priceBreaks : [];
        if (breaks.length > 0 && item.productId) {
          const existingQty = (order?.items ?? [])
            .filter((oi: any) => oi.productId === item.productId && !oi.isBundleHeader && !oi.bundleRef)
            .reduce((s: number, oi: any) => s + (Number(oi.quantity) || 0), 0);
          const addedQty = sizeRows.reduce((s, r) => s + (r.qty || 0), 0);
          const totalQty = existingQty + addedQty;
          const normalised = breaks.map(b => ({ qty: Number(b.qty), price: parseFloat(String(b.price)) })).sort((a, b) => a.qty - b.qty);
          const justUnlocked = normalised.filter(b => b.qty <= totalQty && b.qty > existingQty);
          if (justUnlocked.length > 0) {
            const best = justUnlocked[justUnlocked.length - 1];
            if (best.price < price) {
              const existingLineCount = (order?.items ?? []).filter((oi: any) => oi.productId === item.productId && !oi.isBundleHeader && !oi.bundleRef).length;
              setTimeout(() => setPriceBreakPrompt({
                productId: item.productId!,
                productName: item.productName,
                lineCount: existingLineCount + sizeRows.length,
                oldPrice: price,
                newPrice: best.price,
                tierQty: best.qty,
                totalQty,
              }), 300);
            } else {
              const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
              if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
            }
          } else {
            const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
            if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
          }
        }

        resetDialog();
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setIsAddingMulti(false);
      }
      return;
    }

    // ── Single item: add directly (stock is allocated at confirmation) ──
    // Wardrobe tab: size/qty already set on item. Custom tab: use sizeRows[0].
    const useRowSize = dialogTab === "custom" && sizes.length > 0;
    const singleSize = useRowSize ? (sizeRows[0]?.size || null) : (item.size || null);
    const singleQty = useRowSize ? (sizeRows[0]?.qty ?? item.quantity) : item.quantity;
    doAddItem({ size: singleSize, quantity: singleQty });
  };

  const handleDeleteItem = (itemId: number) => {
    const item = order?.items?.find((i: any) => i.id === itemId);
    const poInfo: Array<{ poNumber: string; status: string; poId: number }> = (item as any)?.poInfo ?? [];
    setDeletingItem({ itemId, poInfo });
  };

  const confirmDeleteItem = (removeFromPo: boolean) => {
    if (!deletingItem) return;
    const { itemId } = deletingItem;
    const url = removeFromPo
      ? `/orders/${orderId}/items/${itemId}?removeFromPo=true`
      : `/orders/${orderId}/items/${itemId}`;
    apiFetch(url, { method: "DELETE" }).then(() => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Item removed" });
      setDeletingItem(null);
    }).catch((e: Error) => {
      toast({ title: "Failed to remove item", description: e.message, variant: "destructive" });
      setDeletingItem(null);
    });
  };

  const postToXeroMutation = useMutation({
    mutationFn: () => apiFetch<{ xeroInvoiceId: string; xeroInvoiceStatus: string }>(`/xero/invoices/${orderId}`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Invoice posted to Xero", description: `Invoice ${res.xeroInvoiceId} created as ${res.xeroInvoiceStatus}.` });
    },
    onError: (e: Error) => toast({ title: "Xero error", description: e.message, variant: "destructive" }),
  });

  const saveInvoiceDateMutation = useMutation({
    mutationFn: (dateStr: string) => apiFetch(`/invoices/${orderId}/invoice-date`, { method: "PATCH", body: JSON.stringify({ invoiceDate: dateStr }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Invoice date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleStatusChange = (newStatus: UpdateOrderBodyStatus) => {
    updateOrderMutation.mutate(
      { id: orderId, data: { status: newStatus } },
      {
        onSuccess: (data: any) => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          queryClient.invalidateQueries({ queryKey: ["order-logs", orderId] });
          if (newStatus === "confirmed" && data?.allocation) {
            const { allocated, purchaseRequired } = data.allocation;
            const parts: string[] = [];
            if (allocated > 0) parts.push(`${allocated} line${allocated !== 1 ? "s" : ""} allocated from stock`);
            if (purchaseRequired > 0) parts.push(`${purchaseRequired} line${purchaseRequired !== 1 ? "s" : ""} flagged for purchasing`);
            toast({ title: "Order Confirmed", description: parts.length ? parts.join(" · ") : "Order confirmed." });
          } else {
            toast({ title: "Status Updated", description: `Order is now ${newStatus}` });
          }
        }
      }
    );
  };

  if (isOrderLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="py-12 text-center text-red-500">Order not found.</div>
      </Layout>
    );
  }

  const selectedProduct = products?.find(p => p.id === item.productId);

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Link href="/orders" className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors text-muted-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">Order {order.orderNumber}</h1>
                {(order as any).absorbedOrderNumbers?.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 mt-1" title={`Merged from: ${(order as any).absorbedOrderNumbers.join(", ")}`}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    +{(order as any).absorbedOrderNumbers.join(" + ")}
                  </span>
                )}
                {(order as any).source === "woocommerce" && (order as any).wooOrderId && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2.5 py-0.5 mt-1">
                    <ShoppingBag className="w-3 h-3" />
                    WC #{(order as any).wooOrderId}
                  </span>
                )}
                <StatusBadge status={order.status} className="mt-1" />
              </div>
              <p className="text-muted-foreground mt-1">
                {formatDate(order.orderDate)} &bull;{" "}
                {order.customerId ? (
                  <a
                    href={`/customers/${order.customerId}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {order.customerName}
                  </a>
                ) : (
                  order.customerName
                )}
              </p>
              <PoNumberInline orderId={orderId} current={(order as any).poNumber ?? null} />
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setSendAckOpen(true)}
              title="Send order acknowledgement email to customer"
            >
              <Mail className="w-4 h-4" />
              Send Ack
            </Button>
            {(order.status === "shipped" || order.status === "part_shipped" || order.status === "delivered") && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => {
                  const initial: Record<number, ReturnSelection> = {};
                  (order.items ?? []).forEach(item => {
                    initial[item.id] = { selected: false, quantity: item.quantity, type: "plain", unitPrice: String((item as any).unitPrice ?? "") };
                  });
                  setReturnSelections(initial);
                  setReturnToStockOpen(true);
                }}
              >
                <RotateCcw className="w-4 h-4" />
                Return to Stock
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setDeleteOrderConfirmOpen(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
            {/* Xero badge — shown in header only when already posted */}
            {(order as any).xeroInvoiceId && (
              <Badge variant="outline" className="gap-1.5 text-indigo-700 border-indigo-300 bg-indigo-50">
                <BookOpen className="w-3.5 h-3.5" />
                Xero: {(order as any).xeroInvoiceStatus ?? "DRAFT"}
              </Badge>
            )}
            <Select value={order.status} onValueChange={(val) => {
              if (val === "confirmed" && order.status !== "confirmed") {
                setConfirmDialogOpen(true);
              } else {
                handleStatusChange(val as UpdateOrderBodyStatus);
              }
            }}>
              <SelectTrigger className="w-[160px] bg-background">
                <SelectValue placeholder="Update Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="quote">Quote</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                {/* "Shipped" is intentionally omitted — orders must go through the
                    Dispatch queue to generate a delivery note. If the order is already
                    shipped (e.g. set externally), show it as a read-only current value. */}
                {(order.status === "shipped" || order.status === "part_shipped") && (
                  <SelectItem value={order.status}>
                    {order.status === "part_shipped" ? "Part Shipped" : "Shipped"}
                  </SelectItem>
                )}
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Portal/website order awaiting confirmation banner */}
        {(order.status === "portal_pending" || order.status === "website_pending" || ((order as any).source === "shop" && order.status === "processing")) && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <Globe className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-900 text-sm">
                  {(order as any).source === "shop" ? "Website order awaiting confirmation" : "Portal order awaiting confirmation"}
                </p>
                <p className="text-amber-700 text-xs mt-0.5">
                  Review the customer account, products and finishes, then confirm or reject the order below.
                </p>
                {(order as any).source === "shop" && (
                  <div className="mt-3 max-w-sm">
                    <Select
                      value={order.customerId ? String(order.customerId) : ""}
                      onValueChange={async (value) => {
                        await apiFetch(`/shop/admin/orders/${order.id}/prepare`, {
                          method: "POST",
                          body: JSON.stringify({ customerId: Number(value) }),
                        });
                        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
                        queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
                        toast({ title: "Customer account linked" });
                      }}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select customer account before confirming" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(20rem,calc(100vh-8rem))] overflow-y-auto">
                        {allCustomers.map((customer: any) => (
                          <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!order.customerId && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-amber-700">Not listed?</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                          disabled={createWebsiteCustomerMutation.isPending}
                          onClick={() => createWebsiteCustomerMutation.mutate()}
                        >
                          {createWebsiteCustomerMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Plus className="h-3.5 w-3.5" />}
                          Create account from website details
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {(order as any).portalNotes && (
                  <p className="text-amber-800 text-xs mt-1.5 italic">Customer note: "{(order as any).portalNotes}"</p>
                )}
                {Array.isArray((order as any).attachments) && (order as any).attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(order as any).attachments.map((att: { name: string; objectPath?: string; url?: string }, i: number) => (
                      <a
                        key={i}
                        href={att.url ?? `${API_BASE}/storage${att.objectPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50 transition-colors"
                      >
                        <Download className="w-3 h-3 shrink-0" />
                        {att.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                disabled={rejectPortalOrderMutation.isPending || confirmPortalOrderMutation.isPending}
                onClick={() => rejectPortalOrderMutation.mutate()}
              >
                {rejectPortalOrderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </Button>
              <Button
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                disabled={confirmPortalOrderMutation.isPending || rejectPortalOrderMutation.isPending || ((order as any).source === "shop" && !order.customerId)}
                onClick={() => confirmPortalOrderMutation.mutate()}
              >
                {confirmPortalOrderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Confirm Order
              </Button>
            </div>
          </div>
        )}

        {/* ── Unconfirm banner (confirmed portal orders not yet in production) */}
        {(order as any).source === "portal" && order.status === "confirmed" && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-3.5 flex items-center gap-3">
            <RotateCcw className="w-4 h-4 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-800 flex-1">
              This order was confirmed from the customer portal.
              If you confirmed it by mistake, you can send it back for review.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 shrink-0"
                  disabled={unconfirmPortalOrderMutation.isPending}
                >
                  {unconfirmPortalOrderMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RotateCcw className="w-3.5 h-3.5" />}
                  Unconfirm
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unconfirm this order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will move the order back to "Portal Pending", restore any stock that was allocated,
                    and remove the auto-generated worksheet (if it hasn't been started).
                    The customer will not be notified.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => unconfirmPortalOrderMutation.mutate()}>
                    Yes, unconfirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* ── Consolidation suggestion ────────────────────────────────────── */}
        {order.status === "draft" && consolidationCandidates.length > 0 && (
          <div className="rounded-xl border border-blue-300 bg-blue-50 px-5 py-4 flex items-start gap-3">
            <GitMerge className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">
                Consider consolidating with {consolidationCandidates.length === 1 ? "an existing order" : "existing orders"}
              </p>
              <p className="text-xs text-blue-700 mt-0.5 mb-2">
                {consolidationCandidates.length === 1
                  ? "This customer has another open order with the same delivery address and PO number. You may want to add these items there instead."
                  : `This customer has ${consolidationCandidates.length} other open orders with the same delivery address and PO number. You may want to add these items to one of them instead.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {consolidationCandidates.map(c => (
                  <div key={c.id} className="flex items-center gap-1">
                    <Link href={`/orders/${c.id}`}>
                      <Button size="sm" variant="outline" className="h-7 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 text-xs">
                        <ExternalLink className="w-3 h-3" />
                        {c.orderNumber}
                        <span className="text-blue-500">·</span>
                        <StatusBadge status={c.status} className="text-[10px] px-1.5 py-0" />
                        <span className="text-blue-500">·</span>
                        {c.itemCount} item{c.itemCount !== 1 ? "s" : ""}
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                      disabled={mergeIntoMutation.isPending}
                      onClick={() => {
                        if (confirm(`Merge this order into ${c.orderNumber}? All items will be moved there and this order (${order.orderNumber}) will be deleted.`)) {
                          mergeIntoMutation.mutate(c.id);
                        }
                      }}
                    >
                      {mergeIntoMutation.isPending && mergeIntoMutation.variables === c.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <GitMerge className="w-3 h-3" />}
                      Merge
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Order Lifecycle Progress ───────────────────────────────────── */}
        {(() => {
          const hasWorksheet = packStatus?.recipients.some(r => r.items.some(i => i.worksheetNumber));
          const isConfirmed = order.status !== "draft" && order.status !== "portal_pending";
          const isCancelled = order.status === "cancelled";
          const isDispatched = !!(order as any).dispatchedAt;
          const isInvoiced = !!(order as any).invoiceEmailSentAt;

          const steps: Array<{ label: string; sublabel?: string; done: boolean; active: boolean; icon: string }> = [
            { label: "Order Created", sublabel: formatDate(order.orderDate), done: true, active: false, icon: "created" },
            { label: isCancelled ? "Cancelled" : "Confirmed", sublabel: isCancelled ? "" : (isConfirmed ? "" : "Awaiting confirmation"), done: isConfirmed || isCancelled, active: !isConfirmed && !isCancelled, icon: "confirmed" },
            { label: "In Production", sublabel: hasWorksheet ? "Worksheet created" : "Pending", done: !!hasWorksheet, active: isConfirmed && !hasWorksheet && !isCancelled, icon: "production" },
            { label: "Dispatched", sublabel: isDispatched ? formatDate((order as any).dispatchedAt) : "Pending", done: isDispatched, active: !!hasWorksheet && !isDispatched && !isCancelled, icon: "dispatched" },
            { label: "Invoice Sent", sublabel: isInvoiced ? formatDate((order as any).invoiceEmailSentAt) : "Pending", done: isInvoiced, active: isDispatched && !isInvoiced && !isCancelled, icon: "invoiced" },
          ];

          return (
            <div className="rounded-xl border border-border/50 bg-card shadow-sm px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Order Progress</span>
              </div>
              <div className="relative flex items-start justify-between gap-0">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex flex-col items-center flex-1 relative">
                    {idx < steps.length - 1 && (
                      <div className={`absolute top-4 left-[50%] w-full h-0.5 -z-0 ${steps[idx + 1].done || (step.done) ? "bg-green-400" : "bg-border"}`} style={{ left: "50%", width: "100%" }} />
                    )}
                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all ${
                      isCancelled && idx === 1 ? "border-red-400 bg-red-50 text-red-600"
                      : step.done ? "border-green-500 bg-green-500 text-white"
                      : step.active ? "border-primary bg-primary/10 text-primary animate-pulse"
                      : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {isCancelled && idx === 1 ? <XCircle className="w-4 h-4" /> : step.done ? <Check className="w-4 h-4" /> : <span>{idx + 1}</span>}
                    </div>
                    <div className="mt-2 text-center px-1">
                      <div className={`text-xs font-semibold ${isCancelled && idx === 1 ? "text-red-600" : step.done ? "text-green-700" : step.active ? "text-primary" : "text-muted-foreground"}`}>{step.label}</div>
                      {step.sublabel && <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{step.sublabel}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 shadow-sm border-border/50 flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10 gap-3 flex-wrap">
              <div className="min-w-0">
                <CardTitle className="font-display">
                  Line Items
                  {lineFilter.trim() && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({filteredItems.length} of {(order.items ?? []).length})
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Products included in this order</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter by SKU, name or recipient…"
                    value={lineFilter}
                    onChange={e => setLineFilter(e.target.value)}
                    className="pl-8 pr-3 py-1 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
                  />
                </div>
                {order.status !== "portal_pending" && order.items && order.items.filter((oi: any) => !oi.purchaseRequired && !oi.isService && oi.stock_status !== 'complete').length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5 border-green-400 text-green-700 hover:bg-green-50" onClick={() => setIsSendToProductionOpen(true)}>
                    <ClipboardList className="w-4 h-4" />
                    Send to Production ({order.items.filter((oi: any) => !oi.purchaseRequired && !oi.isService && oi.stock_status !== 'complete').length})
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5" onClick={() => { setAddBundleId(null); setAddBundleWearerName(""); setCompOverrides({}); setIsAddBundleOpen(true); }}>
                  <Package2 className="w-4 h-4" /> Add Bundle
                </Button>
                <Button size="sm" onClick={() => setIsAddItemOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Item
                </Button>
              </div>
            </CardHeader>

            {/* ── Bulk price bar — shown when a filter is active ─────────────── */}
            {lineFilter.trim() && filteredItems.length > 0 && (
              <div className="flex items-center gap-3 px-6 py-2.5 bg-primary/5 border-b border-primary/20">
                <span className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{filteredItems.length}</span> line{filteredItems.length !== 1 ? "s" : ""} selected
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-sm text-muted-foreground">Set price for all:</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">£</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={bulkPriceInput}
                    onChange={e => setBulkPriceInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") applyBulkPrice(filteredItems); }}
                    className="w-24 h-7 text-sm border border-input rounded px-2 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs px-3"
                    disabled={!bulkPriceInput || bulkPricePending}
                    onClick={() => applyBulkPrice(filteredItems)}
                  >
                    {bulkPricePending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply to all"}
                  </Button>
                </div>
              </div>
            )}

            {(() => {
              // Outstanding items = undispatched non-service lines (only shown on confirmed orders)
              if (order.status === "draft") return null;
              const outstandingItems = (order.items ?? []).filter((i: any) =>
                i.dispatched_at == null && (i.colour || i.size || i.finish_id)
              );
              if (outstandingItems.length === 0) return null;

              // Map backorder info by order_item_id for quick lookup
              const boByItemId = new Map<number, OrderBackorderLine>();
              for (const b of orderBackorders) {
                if (b.orderItemId != null) boByItemId.set(b.orderItemId, b);
              }

              const fmtDue = (d: string) =>
                new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

              return (
                <div className="mx-6 mb-4 rounded-lg border border-amber-300 bg-amber-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100 border-b border-amber-300">
                    <TriangleAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
                    <span className="text-amber-900 font-semibold text-sm">
                      {outstandingItems.length} outstanding item{outstandingItems.length !== 1 ? "s" : ""} — will be dispatched when ready
                    </span>
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-amber-200">
                    {outstandingItems.map((item: any) => {
                      const bo = boByItemId.get(item.id);
                      const isOnBackorder = !!bo;

                      // Derive status label
                      let statusLabel: React.ReactNode;
                      if (isOnBackorder) {
                        statusLabel = (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-200 text-amber-900 border border-amber-300">
                            <ShoppingBag className="w-2.5 h-2.5" /> On backorder
                          </span>
                        );
                      } else if (item.stock_status === "complete") {
                        statusLabel = (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800 border border-green-200">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Ready — awaiting dispatch
                          </span>
                        );
                      } else if (item.stock_status === "allocated") {
                        statusLabel = (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                            <Archive className="w-2.5 h-2.5" /> Allocated from stock
                          </span>
                        );
                      } else if (item.purchase_required) {
                        statusLabel = (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-800 border border-orange-200">
                            <ShoppingBag className="w-2.5 h-2.5" /> In purchasing
                          </span>
                        );
                      } else {
                        statusLabel = (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                            <ClipboardList className="w-2.5 h-2.5" /> In production
                          </span>
                        );
                      }

                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white/60">
                          {/* Left: item description */}
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-sm text-foreground">{item.product_name ?? item.productName}</span>
                            {(item.colour || item.size) && (
                              <span className="text-muted-foreground text-xs ml-2">{[item.colour, item.size].filter(Boolean).join(" / ")}</span>
                            )}
                            <div className="mt-1">{statusLabel}</div>
                            {String(order.status) === "part_shipped" && !isOnBackorder &&
                              item.stock_status === "complete" && !item.purchase_required &&
                              item.finish_id == null && (item.product_id ?? item.productId) != null && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 h-7 text-xs"
                                  disabled={sendToPurchasingMutation.isPending}
                                  onClick={() => {
                                    if (window.confirm(
                                      `Only use this if ${item.product_name ?? item.productName} is not physically available. ` +
                                      "This will send the line to Purchasing; it will not add stock back. Continue?"
                                    )) sendToPurchasingMutation.mutate(item.id);
                                  }}
                                >
                                  Send to Purchasing
                                </Button>
                              )}
                          </div>
                          {/* Right: qty + due date */}
                          <div className="flex items-center gap-4 flex-shrink-0 text-sm">
                            <span className="font-semibold text-foreground tabular-nums">×{item.quantity}</span>
                            {/* Due date — editable when on a PO backorder */}
                            {isOnBackorder ? (
                              editingBackorderDate?.id === bo!.id ? (
                                <form
                                  className="flex items-center gap-1"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    updateBackorderDateMutation.mutate({ id: bo!.id, poId: bo!.poId, date: editingBackorderDate.date });
                                  }}
                                >
                                  <input
                                    type="date"
                                    className="border border-amber-400 rounded px-1.5 py-0.5 text-xs bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    value={editingBackorderDate.date}
                                    onChange={(e) => setEditingBackorderDate(prev => prev ? { ...prev, date: e.target.value } : prev)}
                                    autoFocus
                                  />
                                  <button type="submit" disabled={updateBackorderDateMutation.isPending} className="text-green-700 hover:text-green-900 font-semibold px-1">✓</button>
                                  <button type="button" onClick={() => setEditingBackorderDate(null)} className="text-muted-foreground hover:text-foreground px-1">✕</button>
                                </form>
                              ) : (
                                <button
                                  className="flex items-center gap-1.5 text-xs text-amber-700 hover:bg-amber-100 rounded px-2 py-1 transition-colors group"
                                  title="Click to edit estimated due date"
                                  onClick={() => setEditingBackorderDate({
                                    id: bo!.id,
                                    poId: bo!.poId,
                                    date: bo!.estimatedDueDate ? new Date(bo!.estimatedDueDate).toISOString().slice(0, 10) : "",
                                  })}
                                >
                                  <Calendar className="w-3 h-3" />
                                  {bo!.estimatedDueDate
                                    ? <span className="font-semibold">Due {fmtDue(bo!.estimatedDueDate)}</span>
                                    : <span className="italic text-amber-500 group-hover:text-amber-700">Set due date</span>}
                                </button>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {item.stock_status === "complete" || item.stock_status === "allocated" ? "Ready" : "—"}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Footer hint */}
                  <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700">
                    Backorder due dates are editable. Book in deliveries via <a href="/purchasing?tab=ordered" className="underline font-medium hover:text-amber-900">Purchasing → Ordered</a>.
                  </div>
                </div>
              );
            })()}
            <CardContent className="p-0 flex-1">
              {order.items && order.items.length > 0 ? (
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(["product"] as const).map(col => (
                          <TableHead key={col}>
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none capitalize"
                              onClick={() => toggleSort(col)}
                            >
                              {col}
                              <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
                                {lineSort?.col === col ? (lineSort.dir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </button>
                          </TableHead>
                        ))}
                        {(["price", "qty", "total"] as const).map((col, i) => (
                          <TableHead key={col} className={i === 1 ? "text-center" : "text-right"}>
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none capitalize ml-auto"
                              onClick={() => toggleSort(col)}
                            >
                              {col}
                              <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
                                {lineSort?.col === col ? (lineSort.dir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </button>
                          </TableHead>
                        ))}
                        <TableHead className="w-[72px] text-right text-muted-foreground font-normal text-xs">GP%</TableHead>
                        <TableHead className="w-[36px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((orderItem) => (
                        <TableRow key={orderItem.id} className="group/row">
                          <TableCell>
                            <p className="font-medium text-foreground">
                              {orderItem.productName}
                              {(orderItem as { productSku?: string | null }).productSku && (
                                <span className="ml-1.5 text-xs font-mono text-muted-foreground font-normal">
                                  {(orderItem as { productSku?: string | null }).productSku}
                                </span>
                              )}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1 group/badges">
                              {orderItem.colour && (
                                <Badge variant="outline" className="text-xs gap-1 font-normal">
                                  <Palette className="w-3 h-3" />{orderItem.colour}
                                </Badge>
                              )}
                              {orderItem.size && (
                                <Badge variant="outline" className="text-xs gap-1 font-normal">
                                  <Ruler className="w-3 h-3" />{orderItem.size}
                                </Badge>
                              )}
                              {(orderItem.colour || orderItem.size) && (
                                <button
                                  className="opacity-0 group-hover/badges:opacity-100 transition-opacity inline-flex items-center px-1 py-0.5 rounded text-xs text-muted-foreground hover:text-primary hover:bg-muted"
                                  title="Edit size / colour"
                                  onClick={() => setEditingSizeColour({ itemId: orderItem.id, size: orderItem.size ?? "", colour: orderItem.colour ?? "" })}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                              {(orderItem as { purchaseRequired?: boolean }).purchaseRequired && (() => {
                                return (
                                  <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1 font-normal cursor-default">
                                    <ShoppingBag className="w-3 h-3" />
                                    In purchasing · ×{(orderItem as { purchaseQuantity?: number }).purchaseQuantity ?? 0}
                                  </Badge>
                                );
                              })()}
                              {!(orderItem as any).purchaseRequired && (
                                (orderItem as any).stockStatus === 'allocated' ||
                                ((orderItem as any).stockStatus == null && !((orderItem as any).isService) && !((orderItem as any).isBundleHeader) && ((orderItem as any).poNumbers as string[] | undefined)?.length === 0)
                              ) && (
                                <button
                                  className="opacity-0 group-hover/badges:opacity-100 transition-opacity inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-amber-700 hover:text-amber-900 hover:bg-amber-50 border border-amber-200"
                                  title="Item is not queued for purchasing — click to re-queue"
                                  onClick={() => requeueForPurchaseMutation.mutate([orderItem.id])}
                                  disabled={requeueForPurchaseMutation.isPending}
                                >
                                  <ShoppingBag className="w-3 h-3" />
                                  Re-queue for Purchase
                                </button>
                              )}
                                {orderItem.finishName ? (
                                <Badge variant="secondary" className="text-xs gap-1 font-normal">
                                  <Sparkles className="w-3 h-3" />{orderItem.finishName}
                                </Badge>
                              ) : null}
                              {/* Reset to production — shown for items incorrectly sent to dispatch without a finish */}
                              {(orderItem as any).stockStatus === 'complete' && !(order as any).dispatchedAt && !(orderItem as any).isBundleHeader && (
                                editingItemFinish === orderItem.id ? (
                                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                    <select
                                      autoFocus
                                      className="text-xs border border-amber-400 rounded px-1.5 py-0.5 bg-amber-50 text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                      defaultValue=""
                                      onChange={e => {
                                        const val = e.target.value;
                                        if (!val) return;
                                        const finish = val === "__plain__" ? null : customerFinishes?.find((f: any) => f.id.toString() === val);
                                        resetItemToProductionMutation.mutate({
                                          itemId: orderItem.id,
                                          finishId: finish ? (finish as any).id : null,
                                          finishName: finish ? (finish as any).name : null,
                                        });
                                      }}
                                    >
                                      <option value="">Pick a finish…</option>
                                      {customerFinishes?.map((f: any) => (
                                        <option key={f.id} value={f.id.toString()}>{f.name}</option>
                                      ))}
                                      <option value="__plain__">Plain (no finish)</option>
                                    </select>
                                    <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditingItemFinish(null)}>✕</button>
                                  </div>
                                ) : (
                                  <button
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-amber-700 bg-amber-50 border border-amber-300 hover:bg-amber-100 transition-colors"
                                    title="This item was sent straight to dispatch — click to assign a finish and reset it to the production queue"
                                    onClick={() => setEditingItemFinish(orderItem.id)}
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    Reset to Production
                                  </button>
                                )
                              )}
                            </div>
                            <div className="flex mt-1">
                              {orderItem.recipientType === "person" && orderItem.recipientName ? (
                                <Badge variant="outline" className="text-xs gap-1 border-blue-200 text-blue-700 bg-blue-50 font-normal">
                                  <User className="w-3 h-3" />{orderItem.recipientName}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs gap-1 border-muted-foreground/20 text-muted-foreground font-normal">
                                  <Archive className="w-3 h-3" />Stock
                                </Badge>
                              )}
                            </div>
                            {/* Item notes — shown for all items, editable inline */}
                            {editingItemNotes?.id === orderItem.id ? (
                              <div className="mt-2 flex flex-col gap-1">
                                <textarea
                                  className="w-full text-xs border rounded px-2 py-1.5 resize-none bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                                  value={editingItemNotes.value}
                                  autoFocus
                                  onChange={e => setEditingItemNotes(p => p && ({ ...p, value: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === "Escape") setEditingItemNotes(null);
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                      updateItemNotesMutation.mutate({ itemId: orderItem.id, notes: editingItemNotes.value.trim() || null });
                                    }
                                  }}
                                  placeholder="Notes about this item (e.g. extra logo positions, artwork ref)…"
                                />
                                <div className="flex items-center gap-2">
                                  <Button size="sm" className="h-6 text-xs px-2" disabled={updateItemNotesMutation.isPending} onClick={() => updateItemNotesMutation.mutate({ itemId: orderItem.id, notes: editingItemNotes.value.trim() || null })}>
                                    {updateItemNotesMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                                  </Button>
                                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditingItemNotes(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (orderItem as any).notes ? (
                              <div
                                className="mt-1.5 group/notes cursor-pointer"
                                onClick={() => setEditingItemNotes({ id: orderItem.id, value: (orderItem as any).notes ?? "" })}
                                title="Click to edit item notes"
                              >
                                {((orderItem as any).notes as string).split("\n").map((line: string, i: number) => (
                                  <p key={i} className="text-xs text-amber-700 leading-relaxed flex items-start gap-1">
                                    <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                                    {line}
                                  </p>
                                ))}
                                <span className="text-xs text-muted-foreground opacity-0 group-hover/notes:opacity-100 transition-opacity">Click to edit</span>
                              </div>
                            ) : (
                              <button
                                className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                                onClick={() => setEditingItemNotes({ id: orderItem.id, value: "" })}
                                title="Add item notes"
                              >
                                <MessageSquare className="w-3 h-3" /> Add notes
                              </button>
                            )}
                            {/* VAT selector — subtle, appears on row hover */}
                            <div className="mt-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <select
                                value={String((orderItem as any).vatRate ?? 0.20)}
                                onChange={e => updateItemVatRateMutation.mutate({ itemId: orderItem.id, vatRate: parseFloat(e.target.value) })}
                                className="text-xs rounded px-1 py-0.5 border border-border/40 bg-transparent text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                                title="VAT rate"
                              >
                                <option value="0.2">20% VAT</option>
                                <option value="0.05">5% VAT</option>
                                <option value="0">0% VAT</option>
                              </select>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {editingItemPrice?.id === orderItem.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">£</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editingItemPrice.value}
                                  onChange={e => setEditingItemPrice(p => p && ({ ...p, value: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingItemPrice.value);
                                      if (!isNaN(v) && v >= 0) updateItemPriceMutation.mutate({ itemId: orderItem.id, unitPrice: v });
                                    }
                                    if (e.key === "Escape") setEditingItemPrice(null);
                                  }}
                                  className="h-7 w-24 text-right text-sm px-2"
                                  autoFocus
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-green-600 hover:bg-green-50"
                                  disabled={updateItemPriceMutation.isPending}
                                  onClick={() => {
                                    const v = parseFloat(editingItemPrice.value);
                                    if (!isNaN(v) && v >= 0) updateItemPriceMutation.mutate({ itemId: orderItem.id, unitPrice: v });
                                  }}
                                >
                                  {updateItemPriceMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:bg-muted"
                                  onClick={() => setEditingItemPrice(null)}
                                >
                                  <XCircle className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <button
                                className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                                onClick={() => setEditingItemPrice({ id: orderItem.id, value: String(orderItem.unitPrice) })}
                                title="Click to override price"
                              >
                                {formatCurrency(orderItem.unitPrice)}
                                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="text-center font-semibold">
                            {editingItemQty?.id === orderItem.id ? (
                              <div className="flex items-center justify-center gap-1">
                                <Input
                                  autoFocus
                                  type="number"
                                  min="1"
                                  value={editingItemQty.value}
                                  onChange={e => setEditingItemQty({ id: orderItem.id, value: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const v = parseInt(editingItemQty.value, 10);
                                      if (!isNaN(v) && v > 0) updateItemQtyMutation.mutate({ itemId: orderItem.id, quantity: v });
                                    } else if (e.key === "Escape") {
                                      setEditingItemQty(null);
                                    }
                                  }}
                                  className="h-7 w-16 text-center px-1"
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-green-600 hover:bg-green-50"
                                  disabled={updateItemQtyMutation.isPending}
                                  onClick={() => {
                                    const v = parseInt(editingItemQty.value, 10);
                                    if (!isNaN(v) && v > 0) updateItemQtyMutation.mutate({ itemId: orderItem.id, quantity: v });
                                  }}
                                >
                                  {updateItemQtyMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:bg-muted"
                                  onClick={() => setEditingItemQty(null)}
                                >
                                  <XCircle className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <button
                                className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors mx-auto"
                                onClick={() => setEditingItemQty({ id: orderItem.id, value: String(orderItem.quantity) })}
                                title="Click to edit quantity"
                              >
                                {orderItem.quantity}
                                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-bold text-primary tabular-nums">{formatCurrency(orderItem.lineTotal)}</TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const item = orderItem as any;
                              const garmentCost: number | null = item.garmentCost ?? null;
                              const processCost: number = item.processCost ?? 0;
                              if (garmentCost == null) return <span className="text-xs text-muted-foreground/40">—</span>;
                              const totalCost = garmentCost + processCost;
                              const lineTotal = parseFloat(String(orderItem.lineTotal)) || 0;
                              if (lineTotal <= 0) return <span className="text-xs text-muted-foreground/40">—</span>;
                              const gp = ((lineTotal - totalCost) / lineTotal) * 100;
                              const color = gp >= 65 ? "text-green-700 bg-green-50 border-green-200"
                                          : gp >= 50 ? "text-amber-700 bg-amber-50 border-amber-200"
                                          : "text-red-700 bg-red-50 border-red-200";
                              return (
                                <span className={`inline-block text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded border ${color}`}
                                  title={`Garment: ${formatCurrency(garmentCost)}${processCost > 0 ? ` · Process: ${formatCurrency(processCost)}` : ""} · Total cost: ${formatCurrency(totalCost)}`}>
                                  {gp.toFixed(0)}%
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="w-[36px] p-1 text-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 opacity-0 group-hover/row:opacity-100 transition-opacity" title="Delete line" onClick={() => handleDeleteItem(orderItem.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-16 flex flex-col items-center justify-center text-muted-foreground">
                  <PackageX className="w-12 h-12 mb-3 text-muted-foreground/30" />
                  <p className="font-medium text-foreground">No items added</p>
                  <p className="text-sm">Click "Add Item" to add products to this order.</p>
                </div>
              )}
            </CardContent>
            {order.items && order.items.length > 0 && (
              <div className="p-4 bg-muted/20 border-t border-border/40 flex justify-end items-center gap-4 flex-wrap">
                {lineFilter.trim() && filteredItems.length !== order.items.length && (
                  <span className="text-sm text-muted-foreground">
                    Filtered: <span className="font-semibold text-foreground">{formatCurrency(filteredItems.reduce((s, oi) => s + (parseFloat(String(oi.lineTotal)) || 0), 0))}</span>
                  </span>
                )}
                <span className="text-muted-foreground font-medium">Order Total:</span>
                <span className="text-2xl font-bold font-display text-foreground">{formatCurrency(order.totalAmount)}</span>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg">Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold font-display">
                    {order.customerName ? order.customerName.charAt(0).toUpperCase() : "?"}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{order.customerName || "Unknown Customer"}</p>
                    {order.customerId && (
                      <Link href="/customers" className="text-sm text-primary hover:underline flex items-center gap-1">
                        <LinkIcon className="w-3 h-3" />View profile
                      </Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg flex items-center">
                  <Paperclip className="w-4 h-4 mr-2 text-muted-foreground" /> Attachments
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4 space-y-2">
                {currentAttachments.length > 0 && (
                  <ul className="space-y-1.5">
                    {currentAttachments.map((att, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a
                          href={(att as any).url ?? `${API_BASE}/storage${att.objectPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm flex-1 min-w-0 truncate hover:underline text-foreground"
                        >
                          {att.name}
                        </a>
                        <a
                          href={(att as any).url ?? `${API_BASE}/storage${att.objectPath}`}
                          download={att.name}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          disabled={updateAttachmentsMutation.isPending}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          aria-label="Remove attachment"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <FileDropZone
                  onFile={(file) => uploadFiles([file])}
                  disabled={uploading || updateAttachmentsMutation.isPending}
                  className="py-5 px-4"
                >
                  <FileDropZoneContent
                    uploading={uploading}
                    label="Drag a file here, or click to browse"
                  />
                </FileDropZone>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-muted-foreground" /> Required Date
                  </CardTitle>
                  {!editingRequiredDate && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      const defaultDate = order.requiredDate
                        ? new Date(order.requiredDate).toISOString().split("T")[0]
                        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                      setRequiredDateValue(defaultDate);
                      setEditingRequiredDate(true);
                    }}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4">
                {editingRequiredDate ? (
                  <div className="space-y-2">
                    <Input
                      type="date"
                      value={requiredDateValue}
                      onChange={(e) => setRequiredDateValue(e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => updateRequiredDateMutation.mutate(requiredDateValue || null)} disabled={updateRequiredDateMutation.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingRequiredDate(false)}>Cancel</Button>
                    </div>
                    {(order as { requiredDate?: string | null }).requiredDate && (
                      <Button size="sm" variant="ghost" className="w-full h-7 text-xs text-muted-foreground" onClick={() => updateRequiredDateMutation.mutate(null)}>Clear date</Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm">
                    {(order as { requiredDate?: string | null }).requiredDate ? (
                      <span className="font-medium">{formatDate((order as { requiredDate: string }).requiredDate)}</span>
                    ) : (
                      <span className="text-muted-foreground italic">Not set</span>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <Truck className="w-4 h-4 mr-2 text-muted-foreground" /> Shipping
                  </CardTitle>
                  {!editingShippingMethod && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingShippingMethod(true)}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {/* Shipping method */}
                {editingShippingMethod ? (
                  <div className="space-y-2">
                    <Select
                      value={(order as any).shippingMethod ?? ""}
                      onValueChange={(v) => updateShippingMethodMutation.mutate(v || null)}
                    >
                      <SelectTrigger className="text-sm"><SelectValue placeholder="Select method…" /></SelectTrigger>
                      <SelectContent>
                        {SHIPPING_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingShippingMethod(false)}>Cancel</Button>
                      {(order as any).shippingMethod && (
                        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs text-muted-foreground" onClick={() => updateShippingMethodMutation.mutate(null)}>Clear</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm">
                    {(order as any).shippingMethod
                      ? <span className="font-medium">{SHIPPING_OPTIONS.find(o => o.value === (order as any).shippingMethod)?.label ?? (order as any).shippingMethod}</span>
                      : <span className="text-muted-foreground italic">Not set</span>
                    }
                  </p>
                )}

                {/* DPD retry — shown for dispatched DPD orders with no consignment */}
                {(order as any).dispatchedAt
                  && DPD_METHODS.has((order as any).shippingMethod ?? "")
                  && !(order as any).dpdConsignmentId && (
                  <div className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2.5 flex items-start gap-2.5">
                    <TriangleAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-900">DPD not booked</p>
                      <p className="text-xs text-amber-800">The DPD booking failed when this order was dispatched.</p>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs h-7 shrink-0 border-amber-300 hover:bg-amber-100"
                      onClick={() => { setDpdRetryParcels(1); setDpdRetryWeight(""); setDpdRetryOpen(true); }}>
                      <Truck className="w-3 h-3 mr-1" /> Book DPD
                    </Button>
                  </div>
                )}

                {/* DPD retry dialog */}
                <Dialog open={dpdRetryOpen} onOpenChange={setDpdRetryOpen}>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2"><Truck className="w-4 h-4" /> Book DPD — {order?.orderNumber}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      <div className="space-y-1.5">
                        <Label htmlFor="retry-parcels">Number of boxes</Label>
                        <Input id="retry-parcels" type="number" min={1} step={1} value={dpdRetryParcels}
                          onChange={(e) => setDpdRetryParcels(Math.max(1, parseInt(e.target.value) || 1))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="retry-weight">Total weight (kg)</Label>
                        <Input id="retry-weight" type="number" min={0.1} step={0.1} placeholder="e.g. 2.5" value={dpdRetryWeight}
                          onChange={(e) => setDpdRetryWeight(e.target.value === "" ? "" : parseFloat(e.target.value))} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setDpdRetryOpen(false)}>Cancel</Button>
                      <Button onClick={() => retryDpdMutation.mutate()}
                        disabled={retryDpdMutation.isPending || dpdRetryWeight === ""}>
                        {retryDpdMutation.isPending ? "Booking…" : "Book DPD"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Carriage amount */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Carriage (exc. VAT)</p>
                    {!editingCarriage && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { const current = parseFloat((order as any).carriageAmount ?? "0"); setCarriageInput((current === 0 ? 8.50 : current).toFixed(2)); setEditingCarriage(true); }}>
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                  {editingCarriage ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = parseFloat(carriageInput);
                        if (!isNaN(v) && v >= 0) updateCarriageMutation.mutate(v);
                      }}
                    >
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={carriageInput}
                          onChange={(e) => setCarriageInput(e.target.value)}
                          className="w-full h-8 pl-6 pr-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                      </div>
                      <Button type="submit" size="icon" className="h-8 w-8" disabled={updateCarriageMutation.isPending}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingCarriage(false)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm font-medium">
                      £{parseFloat((order as any).carriageAmount ?? "0").toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Number of boxes */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Number of Boxes</p>
                    {!editingBoxes && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setBoxesInput(String((order as any).numberOfBoxes ?? 1)); setEditingBoxes(true); }}>
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                  {editingBoxes ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = parseInt(boxesInput, 10);
                        if (!isNaN(v) && v >= 1) updateBoxesMutation.mutate(v);
                      }}
                    >
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={boxesInput}
                        onChange={(e) => setBoxesInput(e.target.value)}
                        className="w-full h-8 px-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <Button type="submit" size="icon" className="h-8 w-8" disabled={updateBoxesMutation.isPending}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingBoxes(false)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm font-medium">{(order as any).numberOfBoxes ?? 1} {((order as any).numberOfBoxes ?? 1) === 1 ? "box" : "boxes"}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-muted-foreground" /> Delivery Address
                  </CardTitle>
                  {!editingDeliveryAddress && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingDeliveryAddress(true)}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {editingDeliveryAddress ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedAddressId}
                      onValueChange={setSelectedAddressId}
                    >
                      <SelectTrigger className="text-sm flex-1"><SelectValue placeholder="Select address…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        {customerDeliveryAddresses?.map((a: any) => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            {a.label ? `${a.label} — ` : ""}{[a.line1, a.city, a.postcode].filter(Boolean).join(", ")}
                            {a.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="default"
                      className="h-8 w-8 shrink-0"
                      disabled={updateDeliveryAddressMutation.isPending}
                      onClick={() => {
                        const id = selectedAddressId === "none" ? null : parseInt(selectedAddressId, 10);
                        updateDeliveryAddressMutation.mutate(id);
                      }}
                    >
                      {updateDeliveryAddressMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Check className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingDeliveryAddress(false)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : null}
                {(() => {
                  const addr = (order as any).deliveryAddress as DeliveryAddress | null | undefined;
                  const fallback = (order as any).customerMainAddress as { line1: string; city: string | null; postcode: string | null } | null | undefined;
                  if (!addr) {
                    if (fallback) {
                      return (
                        <div className="text-sm space-y-0.5 pt-1">
                          <p className="text-muted-foreground">{fallback.line1}</p>
                          <p className="text-muted-foreground">{[fallback.city, fallback.postcode].filter(Boolean).join(", ")}</p>
                          <p className="text-[11px] text-amber-600 mt-1">Using account address — add a delivery address to the customer profile to override</p>
                        </div>
                      );
                    }
                    return (customerDeliveryAddresses?.length ?? 0) === 0
                      ? <p className="text-sm text-muted-foreground italic">No addresses on file for this customer</p>
                      : null;
                  }
                  return (
                    <div className="text-sm space-y-0.5 pt-1">
                      {addr.label && <p className="font-medium text-foreground">{addr.label}</p>}
                      {addr.line1 && <p className="text-muted-foreground">{addr.line1}</p>}
                      {addr.line2 && <p className="text-muted-foreground">{addr.line2}</p>}
                      <p className="text-muted-foreground">{[addr.city, addr.county, addr.postcode].filter(Boolean).join(", ")}</p>
                      {addr.country && addr.country !== "United Kingdom" && <p className="text-muted-foreground">{addr.country}</p>}
                    </div>
                  );
                })()}
                {((order as any).addressGroups?.length ?? 0) > 1 && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                      <TriangleAlert className="w-3.5 h-3.5" />
                      Multiple delivery addresses — documents will be split per address
                    </p>
                    {(order as any).addressGroups.map((g: any, i: number) => (
                      <div key={i} className="text-xs bg-muted/40 rounded-md px-3 py-2 border border-border/40">
                        <p className="font-medium text-foreground">{g.address?.label || [g.address?.line1, g.address?.city].filter(Boolean).join(", ")}</p>
                        <p className="text-muted-foreground">{[g.address?.line1, g.address?.city, g.address?.postcode].filter(Boolean).join(", ")}</p>
                        <p className="text-muted-foreground/60 mt-0.5">{g.itemIds?.length} item{(g.itemIds?.length ?? 0) !== 1 ? "s" : ""}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Invoice Address ── */}
            {(customerInvoiceAddresses?.length ?? 0) > 0 && (
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-muted-foreground" /> Invoice Address
                  </CardTitle>
                  {!editingInvoiceAddress && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingInvoiceAddress(true)}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {editingInvoiceAddress ? (
                  <div className="flex items-center gap-2">
                    <Select value={selectedInvoiceAddressId} onValueChange={setSelectedInvoiceAddressId}>
                      <SelectTrigger className="text-sm flex-1"><SelectValue placeholder="Select invoice address…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Use account default</SelectItem>
                        {customerInvoiceAddresses?.map((a: any) => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            {a.label ? `${a.label} — ` : ""}{[a.name, a.city, a.postcode].filter(Boolean).join(", ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="default" className="h-8 w-8 shrink-0"
                      disabled={updateInvoiceAddressMutation.isPending}
                      onClick={() => {
                        const id = selectedInvoiceAddressId === "none" ? null : parseInt(selectedInvoiceAddressId, 10);
                        updateInvoiceAddressMutation.mutate(id);
                      }}>
                      {updateInvoiceAddressMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingInvoiceAddress(false)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : null}
                {(() => {
                  const addrId = (order as any)?.invoiceAddressId as number | null | undefined;
                  const ia = addrId ? customerInvoiceAddresses?.find((a: any) => a.id === addrId) : null;
                  if (ia) {
                    return (
                      <div className="text-sm space-y-0.5 pt-1">
                        {ia.label && <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{ia.label}</p>}
                        {ia.name && <p className="font-medium text-foreground">{ia.name}</p>}
                        {ia.address && <p className="text-muted-foreground">{ia.address}</p>}
                        {ia.line2 && <p className="text-muted-foreground">{ia.line2}</p>}
                        <p className="text-muted-foreground">{[ia.city, ia.postcode].filter(Boolean).join(", ")}</p>
                        {ia.billingEmail && <p className="text-muted-foreground text-xs mt-1">{ia.billingEmail}</p>}
                      </div>
                    );
                  }
                  // No specific address set — show the default if one exists
                  const def = customerInvoiceAddresses?.find((a: any) => a.isDefault) ?? customerInvoiceAddresses?.[0];
                  if (def) {
                    return (
                      <div className="text-sm space-y-0.5 pt-1">
                        {def.name && <p className="font-medium text-foreground">{def.name}</p>}
                        {def.address && <p className="text-muted-foreground">{def.address}</p>}
                        <p className="text-muted-foreground">{[def.city, def.postcode].filter(Boolean).join(", ")}</p>
                        {def.billingEmail && <p className="text-muted-foreground text-xs mt-1">{def.billingEmail}</p>}
                        <p className="text-[11px] text-amber-600 mt-1">Using account default — click edit to override for this order</p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </CardContent>
            </Card>
            )}

            <AttentionOfCard
              orderId={orderId}
              current={
                (order as any).attentionOf ??
                (order.source === "portal" ? ((order as any).portalSubmittedByName ?? null) : null)
              }
            />

            {/* Invoicing card — show once dispatched/shipped */}
            {((order as any).xeroInvoiceId || order.status === "shipped" || order.status === "dispatched") && (() => {
              const rawInvoiceDate: string | null = (order as any).invoiceDate ?? null;
              const rawOrderDate: string | null = (order as any).orderDate ?? null;
              const invoiceDateValue = rawInvoiceDate
                ? new Date(rawInvoiceDate).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);
              const crossMonth = rawOrderDate && rawInvoiceDate && (() => {
                const od = new Date(rawOrderDate);
                const id = new Date(rawInvoiceDate);
                return od.getMonth() !== id.getMonth() || od.getFullYear() !== id.getFullYear();
              })();
              return (
                <Card className="shadow-sm border-border/50">
                  <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                    <CardTitle className="font-display text-lg flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-500" /> Invoicing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 space-y-3">
                    {/* Invoice date field */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice Date</label>
                      {crossMonth && (
                        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>Order placed in a different month — invoice date set to order date to keep records in the same period.</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="date"
                          defaultValue={invoiceDateValue}
                          key={invoiceDateValue}
                          className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onChange={(e) => {
                            if (e.target.value) saveInvoiceDateMutation.mutate(e.target.value);
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Used on the invoice email and Xero entry.</p>
                    </div>

                    {/* Xero status / action */}
                    {(order as any).xeroInvoiceId ? (
                      <div className="space-y-1 text-sm pt-1 border-t border-border/40">
                        <div className="flex items-center gap-2 pt-2">
                          <Badge variant="outline" className="gap-1.5 text-indigo-700 border-indigo-300 bg-indigo-50">
                            <BookOpen className="w-3 h-3" /> {(order as any).xeroInvoiceStatus ?? "DRAFT"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">Xero invoice ID: {(order as any).xeroInvoiceId}</p>
                      </div>
                    ) : (
                      <div className="pt-1 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50 w-full mt-2"
                          onClick={() => postToXeroMutation.mutate()}
                          disabled={postToXeroMutation.isPending}
                        >
                          {postToXeroMutation.isPending
                            ? <><Loader2 className="w-4 h-4 animate-spin" />Posting…</>
                            : <><BookOpen className="w-4 h-4" />Post to Xero</>}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-muted-foreground" /> Notes
                  </CardTitle>
                  {!editingNotes && (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={printOrderNotes} title="Print notes">
                        <Printer className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                        setNotesValue(order.notes ?? "");
                        setEditingNotes(true);
                      }} title="Edit notes">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {(order as any).portalNotes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <p className="text-xs font-medium text-amber-700 mb-1">Customer note (via portal)</p>
                    <p className="text-sm text-amber-900 whitespace-pre-wrap">{(order as any).portalNotes}</p>
                  </div>
                )}
                {((order as any).items ?? []).some((item: any) => item.notes?.trim()) && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line item notes</p>
                    {((order as any).items ?? [])
                      .filter((item: any) => item.notes?.trim())
                      .map((item: any) => (
                        <button
                          key={item.id}
                          type="button"
                          className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left hover:bg-amber-100 transition-colors"
                          onClick={() => setEditingItemNotes({ id: item.id, value: item.notes ?? "" })}
                          title="Edit this line note"
                        >
                          <p className="text-xs font-medium text-amber-700">
                            {[item.productName, item.recipientName].filter(Boolean).join(" — ") || "Order line"}
                          </p>
                          <p className="mt-1 text-sm text-amber-950 whitespace-pre-wrap">{item.notes}</p>
                        </button>
                      ))}
                  </div>
                )}
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      placeholder="Add notes for this order…"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => updateNotesMutation.mutate(notesValue || null)} disabled={updateNotesMutation.isPending}>
                        {updateNotesMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingNotes(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-sm cursor-pointer hover:bg-muted/40 transition-colors bg-muted/30 p-3 rounded-lg border border-border/50 min-h-[80px]"
                    onClick={() => { setNotesValue(order.notes ?? ""); setEditingNotes(true); }}
                  >
                    {order.notes
                      ? <span className="whitespace-pre-wrap">{order.notes}</span>
                      : <span className="text-muted-foreground italic">No notes for this order. Click to add.</span>
                    }
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Wearer Labels ──────────────────────────────────────────────── */}
            {packStatus && packStatus.recipients.some(r => r.items.some(i => i.isComplete)) && (
              <Card className="shadow-sm border-border/50">
                <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                  <CardTitle className="font-display text-lg flex items-center gap-2">
                    <Printer className="w-4 h-4 text-muted-foreground" /> Wearer Labels
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-3 space-y-2">
                  <p className="text-xs text-muted-foreground mb-3">Print labels for recipients whose items have been received. Partial packs are allowed — only received items appear on the label.</p>
                  {packStatus.recipients.map((recipient, idx) => {
                    const receivedItems = recipient.items.filter(i => i.isComplete);
                    const totalItems = recipient.items.length;
                    if (receivedItems.length === 0) return null;
                    const displayName = recipient.recipientType === "stock" ? "Bulk Stock" : (recipient.recipientName ?? "Unknown");
                    const isPartial = receivedItems.length < totalItems;
                    return (
                      <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{displayName}</p>
                          {recipient.jobTitle && <p className="text-xs text-muted-foreground truncate">{recipient.jobTitle}</p>}
                          <div className="flex items-center gap-1.5 mt-1">
                            {isPartial ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                <TriangleAlert className="w-3 h-3" /> {receivedItems.length}/{totalItems} received
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                                <Check className="w-3 h-3" /> All {totalItems} received
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 gap-1.5 text-xs"
                          onClick={() => printLabel(recipient, receivedItems)}
                        >
                          <Printer className="w-3.5 h-3.5" /> Print
                        </Button>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

          </div>
        </div>

        {/* ── GP Summary — internal only ─────────────────────────────────── */}
        {order.items && order.items.length > 0 && (() => {
          type GpGroup = {
            productName: string;
            productSku: string | null;
            totalQty: number;
            totalRevenue: number;
            totalCost: number | null;
            hasMissingCost: boolean;
          };
          // Bundle-aware GP grouping:
          // 1. Per bundleRef: pair the header's revenue with all component costs.
          // 2. Aggregate bundle instances sharing the same product name into one row.
          // 3. Non-bundle items group by product name as usual.
          type BundleInstance = {
            name: string; sku: string | null;
            qty: number; revenue: number;
            cost: number | null; hasMissingCost: boolean;
          };
          const bundleInstances = new Map<string, BundleInstance>();
          for (const item of order.items) {
            const bRef = (item as any).bundleRef as string | null | undefined;
            if (!bRef) continue;
            if (!bundleInstances.has(bRef)) {
              bundleInstances.set(bRef, { name: "", sku: null, qty: 0, revenue: 0, cost: 0, hasMissingCost: false });
            }
            const inst = bundleInstances.get(bRef)!;
            if ((item as any).isBundleHeader) {
              inst.name = item.productName ?? "Bundle";
              inst.sku = (item as any).productSku ?? null;
              inst.qty += Number(item.quantity ?? 0);
              inst.revenue += parseFloat(String(item.lineTotal)) || 0;
            } else {
              const garmentCost: number | null = (item as any).garmentCost ?? null;
              const processCost: number = (item as any).processCost ?? 0;
              if (garmentCost != null) {
                inst.cost = (inst.cost ?? 0) + garmentCost + processCost;
              } else {
                inst.hasMissingCost = true;
                inst.cost = null;
              }
            }
          }

          const groupMap = new Map<string, GpGroup>();

          // Aggregate bundle instances by bundle product name
          for (const inst of bundleInstances.values()) {
            const key = `__BUNDLE__|||${inst.name}|||${inst.sku ?? ""}`;
            if (!groupMap.has(key)) {
              groupMap.set(key, { productName: inst.name, productSku: inst.sku, totalQty: 0, totalRevenue: 0, totalCost: 0, hasMissingCost: false });
            }
            const g = groupMap.get(key)!;
            g.totalQty += inst.qty;
            g.totalRevenue += inst.revenue;
            if (inst.hasMissingCost) { g.hasMissingCost = true; g.totalCost = null; }
            else if (!g.hasMissingCost) { g.totalCost = (g.totalCost ?? 0) + (inst.cost ?? 0); }
          }

          // Non-bundle items
          for (const item of order.items) {
            if ((item as any).isBundleHeader || (item as any).bundleRef) continue;
            const key = (item.productName ?? "Unknown") + "|||" + ((item as any).productSku ?? "");
            if (!groupMap.has(key)) {
              groupMap.set(key, {
                productName: item.productName ?? "Unknown",
                productSku: (item as any).productSku ?? null,
                totalQty: 0,
                totalRevenue: 0,
                totalCost: 0,
                hasMissingCost: false,
              });
            }
            const g = groupMap.get(key)!;
            g.totalQty += Number(item.quantity ?? 0);
            g.totalRevenue += parseFloat(String(item.lineTotal)) || 0;
            const garmentCost: number | null = (item as any).garmentCost ?? null;
            const processCost: number = (item as any).processCost ?? 0;
            if (garmentCost != null) {
              g.totalCost = (g.totalCost ?? 0) + garmentCost + processCost;
            } else {
              g.hasMissingCost = true;
              g.totalCost = null;
            }
          }
          const rows = Array.from(groupMap.values());
          const grandRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
          const grandCost = rows.some(r => r.hasMissingCost || r.totalCost == null)
            ? null
            : rows.reduce((s, r) => s + (r.totalCost ?? 0), 0);
          const grandGP = grandCost != null ? grandRevenue - grandCost : null;
          const grandGpPct = grandRevenue > 0 && grandGP != null ? (grandGP / grandRevenue) * 100 : null;
          const gpColor = (pct: number | null) =>
            pct == null ? "text-muted-foreground" :
            pct >= 65 ? "text-green-700" :
            pct >= 50 ? "text-amber-700" :
            "text-red-700";
          return (
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                  GP Summary
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border/50">Internal only</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right w-16">Qty</TableHead>
                      <TableHead className="text-right w-28">Unit Sell</TableHead>
                      <TableHead className="text-right w-28">Unit Cost</TableHead>
                      <TableHead className="text-right w-28">Revenue</TableHead>
                      <TableHead className="text-right w-28">Cost</TableHead>
                      <TableHead className="text-right w-28">GP £</TableHead>
                      <TableHead className="text-right w-24">GP %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const gp = row.totalCost != null ? row.totalRevenue - row.totalCost : null;
                      const gpPct = row.totalRevenue > 0 && gp != null ? (gp / row.totalRevenue) * 100 : null;
                      const unitSell = row.totalQty > 0 ? row.totalRevenue / row.totalQty : null;
                      const unitCost = row.totalCost != null && row.totalQty > 0 ? row.totalCost / row.totalQty : null;
                      return (
                        <TableRow key={row.productName + row.productSku}>
                          <TableCell>
                            <p className="font-medium text-sm text-foreground">{row.productName}</p>
                            {row.productSku && (
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{row.productSku}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{row.totalQty}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {unitSell != null ? formatCurrency(unitSell) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {unitCost != null ? formatCurrency(unitCost) : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            {formatCurrency(row.totalRevenue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {row.totalCost != null ? formatCurrency(row.totalCost) : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums text-sm font-medium ${gp != null && gp < 0 ? "text-red-700" : ""}`}>
                            {gp != null ? formatCurrency(gp) : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {gpPct != null ? (
                              <span className={`text-sm font-bold tabular-nums ${gpColor(gpPct)}`}>
                                {gpPct.toFixed(1)}%
                              </span>
                            ) : <span className="text-muted-foreground/40 text-sm">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold text-foreground">Order Total</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {rows.reduce((s, r) => s + r.totalQty, 0)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(grandRevenue)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-muted-foreground">
                        {grandCost != null ? formatCurrency(grandCost) : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${grandGP != null && grandGP < 0 ? "text-red-700" : ""}`}>
                        {grandGP != null ? formatCurrency(grandGP) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {grandGpPct != null ? (
                          <span className={`text-base font-bold tabular-nums ${gpColor(grandGpPct)}`}>
                            {grandGpPct.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Internal Messages ─────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <CardTitle className="font-display flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              Internal Messages
            </CardTitle>
            <CardDescription>Staff notes and discussion about this job — not visible to the customer</CardDescription>
          </CardHeader>
          <CardContent className="py-5">
            <OrderMessages orderId={orderId} />
          </CardContent>
        </Card>

        {/* ── Email Log ────────────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="font-display text-lg">Order Acknowledgement</CardTitle>
                <CardDescription>
                  {emailLogs.length === 0
                    ? "No acknowledgement has been sent yet"
                    : `${emailLogs.length} email${emailLogs.length !== 1 ? "s" : ""} sent`}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setSendAckOpen(true)}
            >
              <Mail className="w-3.5 h-3.5" />
              {emailLogs.length === 0 ? "Send Acknowledgement" : "Resend"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {emailLogs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                Use the button above to send the order acknowledgement to the customer.
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {emailLogs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${log.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                      {log.success
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{log.success ? "Sent" : "Failed"} to {log.toEmail}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.sentAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {log.subject && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.subject}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        {log.sentBy && log.sentBy !== "System" && (
                          <span className="text-xs text-muted-foreground/70">by {log.sentBy}</span>
                        )}
                        {!log.success && log.error && (
                          <span className="text-xs text-red-500">{log.error}</span>
                        )}
                        <a
                          href={`/api/orders/${orderId}/acknowledgement.eml`}
                          download
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                          title="Download as .eml to open in email client"
                        >
                          <Download className="w-3 h-3" /> Download .eml
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Activity Log ─────────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="font-display text-lg">Activity Log</CardTitle>
                <CardDescription>Full history of actions on this order</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {actorEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="text-sm border rounded px-2 py-1 w-36 outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Your name"
                    value={actorDraft}
                    onChange={e => setActorDraft(e.target.value)}
                    onBlur={saveActorName}
                    onKeyDown={e => { if (e.key === "Enter") saveActorName(); if (e.key === "Escape") setActorEditing(false); }}
                  />
                  <Button size="sm" variant="ghost" onClick={saveActorName} className="h-7 px-2 text-xs">Save</Button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setActorDraft(actorName); setActorEditing(true); }}
                  title="Set your name so actions are logged under your name"
                >
                  <User className="w-3.5 h-3.5" />
                  {actorName ? <><span className="font-medium text-foreground">{actorName}</span> <span className="opacity-60">(change)</span></> : <span className="italic">Set your name</span>}
                </button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetchLogs()} title="Refresh log">
                <ClipboardList className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {orderLogs.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No activity recorded yet</p>
                <p className="text-xs mt-1 opacity-60">Actions like confirming or dispatching will appear here</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[2.75rem] top-0 bottom-0 w-px bg-border/50" />
                <ul className="py-3 space-y-0">
                  {orderLogs.map((log, idx) => (
                    <li key={log.id} className={`relative flex gap-4 px-5 py-3 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{log.action}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <User className="w-3 h-3 text-muted-foreground/60" />
                          <span className="text-xs text-muted-foreground">{log.actor === "System" ? <span className="italic">System</span> : <span className="font-medium">{log.actor}</span>}</span>
                        </div>
                        {log.details && <p className="text-xs text-muted-foreground/70 mt-1 leading-snug">{log.details}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isAddItemOpen} onOpenChange={(open) => { if (!open) resetDialog(); else setIsAddItemOpen(true); }}>
          <DialogContent className={cn("max-h-[90vh] flex flex-col overflow-hidden", dialogTab === "wardrobe" ? "max-w-2xl" : "max-w-lg")}>
            <DialogHeader className="shrink-0">
              <DialogTitle className="font-display">Add Line Item</DialogTitle>
            </DialogHeader>

            <Tabs value={dialogTab} onValueChange={(v) => { setDialogTab(v as "wardrobe" | "custom" | "service"); if (v !== "wardrobe") setItem({ ...EMPTY_ITEM }); }} className="flex flex-col flex-1 overflow-hidden">
              <TabsList className="shrink-0 w-full grid grid-cols-3">
                <TabsTrigger value="wardrobe" className="flex items-center gap-1.5">
                  <ShoppingBag className="w-3.5 h-3.5" /> Wardrobe
                  {(customerFinishedItems?.length ?? 0) > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                      {customerFinishedItems!.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Custom Item
                </TabsTrigger>
                <TabsTrigger value="service" className="flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" /> Service
                  {(serviceProducts?.length ?? 0) > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-700">
                      {serviceProducts!.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── WARDROBE TAB ───────────────────────────────────────────── */}
              <TabsContent value="wardrobe" className="flex-1 overflow-y-auto mt-0 pt-3 data-[state=inactive]:hidden">
                {!customerFinishedItems?.length ? (
                  /* No wardrobe configured */
                  <div className="py-10 text-center text-muted-foreground">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No wardrobe items yet</p>
                    <p className="text-xs mt-1 text-muted-foreground/70 mb-4">Add items to this customer's wardrobe first.</p>
                    {customerId && (
                      <a
                        href={`${import.meta.env.BASE_URL}customers/${customerId}?tab=wardrobe`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Edit Wardrobe
                      </a>
                    )}
                  </div>
                ) : wardrobeRecipient === null ? (
                  /* ── Step 1: Pick a person ── */
                  <div className="space-y-3 pb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground shrink-0">Who is this order for?</p>
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          value={empSearch}
                          onChange={e => setEmpSearch(e.target.value)}
                          placeholder="Search by name…"
                          className="w-full h-8 pl-8 pr-3 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-primary"
                          autoFocus
                        />
                      </div>
                      {customerId && (
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <a
                            href={`${import.meta.env.BASE_URL}customers/${customerId}?tab=wardrobe`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            title="Edit this customer's wardrobe"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Edit Wardrobe
                          </a>
                          {!addRecipientOpen && (
                            <button
                              type="button"
                              onClick={() => setAddRecipientOpen(true)}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Plus className="w-3.5 h-3.5" /> Add Recipient
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {!empSearch && (
                        <button
                          onClick={() => handleWardrobePersonSelect("stock")}
                          className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group"
                        >
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3 group-hover:bg-muted/70 transition-colors">
                            <Archive className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <p className="font-semibold text-sm">Bulk Stock</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">No specific recipient</p>
                        </button>
                      )}
                        {customerEmployees?.filter(emp => {
                        if (!empSearch.trim()) return true;
                        const full = [emp.firstName, emp.lastName].filter(Boolean).join(" ").toLowerCase();
                        return full.includes(empSearch.trim().toLowerCase());
                      }).map(emp => {
                        const initials = [emp.firstName?.[0], emp.lastName?.[0]].filter(Boolean).join("").toUpperCase();
                          const draft = employeeEdits[emp.id] ?? { roleId: emp.roleId ?? null, deliveryAddressId: emp.deliveryAddressId ?? null };
                          const hasChanges = draft.roleId !== (emp.roleId ?? null);
                          const canSelectDetails = customerRoles.length > 0;
                          const isSavingThisEmployee = saveEmployeeDetails.isPending && saveEmployeeDetails.variables?.employeeId === emp.id;
                        return (
                          <div
                            key={emp.id}
                            onClick={() => handleWardrobePersonSelect(emp)}
                            onKeyDown={event => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleWardrobePersonSelect(emp);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group"
                          >
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm mb-3 group-hover:bg-primary/15 transition-colors">
                              {initials || <User className="w-4 h-4" />}
                            </div>
                            <p className="font-semibold text-sm leading-tight">{[emp.firstName, emp.lastName].filter(Boolean).join(" ")}</p>
                            {(emp.roleName || emp.jobTitle) && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.roleName ?? emp.jobTitle}</p>
                            )}
                            {canSelectDetails && (
                              <div className="mt-3 pt-3 border-t border-border/60 space-y-2" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                                {customerRoles.length > 0 && (
                                  <div>
                                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Grade</label>
                                    <Select
                                      value={draft.roleId != null ? String(draft.roleId) : "none"}
                                      disabled={isSavingThisEmployee}
                                      onValueChange={value => setEmployeeEdits(previous => ({
                                        ...previous,
                                        [emp.id]: { ...draft, roleId: value === "none" ? null : Number(value) },
                                      }))}
                                    >
                                      <SelectTrigger disabled={isSavingThisEmployee} className="h-7 text-xs bg-background"><SelectValue placeholder="No grade" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">No grade</SelectItem>
                                        {customerRoles.map(role => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )}
                                {hasChanges && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 w-full text-xs"
                                    disabled={isSavingThisEmployee}
                                    onClick={() => saveEmployeeDetails.mutate({ employeeId: emp.id, ...draft })}
                                  >
                                    {isSavingThisEmployee ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save details"}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {empSearch.trim() && customerEmployees?.filter(emp => {
                        const full = [emp.firstName, emp.lastName].filter(Boolean).join(" ").toLowerCase();
                        return full.includes(empSearch.trim().toLowerCase());
                      }).length === 0 && (
                        <p className="col-span-3 text-sm text-muted-foreground text-center py-6">No employees match "{empSearch}"</p>
                      )}

                      {/* Inline add-recipient form */}
                      {addRecipientOpen && (
                        <div className="col-span-full rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
                          <p className="text-sm font-semibold text-foreground">New Recipient</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">First name *</label>
                              <Input
                                autoFocus
                                placeholder="First name"
                                value={addRecipientForm.firstName}
                                onChange={e => setAddRecipientForm(f => ({ ...f, firstName: e.target.value }))}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Last name</label>
                              <Input
                                placeholder="Last name"
                                value={addRecipientForm.lastName}
                                onChange={e => setAddRecipientForm(f => ({ ...f, lastName: e.target.value }))}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Job title / role</label>
                            {customerRoles.length > 0 ? (
                              <Select
                                value={addRecipientForm.jobTitle || "none"}
                                onValueChange={v => setAddRecipientForm(f => ({ ...f, jobTitle: v === "none" ? "" : v }))}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Select role…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No role</SelectItem>
                                  {customerRoles.map(r => (
                                    <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                placeholder="e.g. Driver"
                                value={addRecipientForm.jobTitle}
                                onChange={e => setAddRecipientForm(f => ({ ...f, jobTitle: e.target.value }))}
                                className="h-8 text-sm"
                              />
                            )}
                          </div>
                          {customerTeams.length > 0 && (
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Team</label>
                              <Select
                                value={addRecipientForm.teamId != null ? String(addRecipientForm.teamId) : "none"}
                                onValueChange={v => setAddRecipientForm(f => ({ ...f, teamId: v === "none" ? null : Number(v) }))}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Select team…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No team</SelectItem>
                                  {customerTeams.map(team => (
                                    <SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <div className="flex justify-end gap-2 pt-1">
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setAddRecipientOpen(false); setAddRecipientForm({ firstName: "", lastName: "", jobTitle: "", teamId: null }); }}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7"
                              disabled={!addRecipientForm.firstName.trim() || addRecipientSaving}
                              onClick={async () => {
                                setAddRecipientSaving(true);
                                try {
                                  const newEmp = await apiFetch(`/customers/${customerId}/employees`, {
                                    method: "POST",
                                    body: JSON.stringify({
                                      firstName: addRecipientForm.firstName.trim(),
                                      lastName: addRecipientForm.lastName.trim() || null,
                                      jobTitle: addRecipientForm.jobTitle.trim() || null,
                                      teamId: addRecipientForm.teamId ?? null,
                                    }),
                                  });
                                  await queryClient.invalidateQueries({ queryKey: ["customer-employees", customerId] });
                                  setAddRecipientOpen(false);
                                  setAddRecipientForm({ firstName: "", lastName: "", jobTitle: "", teamId: null });
                                  handleWardrobePersonSelect(newEmp);
                                } catch {
                                  toast({ title: "Could not create recipient", variant: "destructive" });
                                } finally {
                                  setAddRecipientSaving(false);
                                }
                              }}
                            >
                              {addRecipientSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save & Select"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Step 2: Items for the selected person ── */
                  <div className="space-y-2 pb-2">
                    {/* Header / breadcrumb */}
                    <div className="flex items-center gap-3 pb-1 border-b border-border/50">
                      <button
                        onClick={() => { setWardrobeRecipient(null); setWardrobeItemSizes({}); setWardrobeItemQtys({}); setWardrobeSearch(""); }}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {wardrobeRecipient === "stock" ? (
                          <>
                            <Archive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">Bulk Stock</span>
                          </>
                        ) : (
                          <>
                            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {[(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")}
                            </span>
                            {(wardrobeRecipient as CustomerEmployee).roleName && (
                              <span className="text-xs text-muted-foreground shrink-0">{(wardrobeRecipient as CustomerEmployee).roleName}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Search box */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search by name or SKU…"
                        value={wardrobeSearch}
                        onChange={e => setWardrobeSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    {/* Card grid — matches portal wardrobe layout */}
                    {(() => {
                      const wq = wardrobeSearch.toLowerCase().trim();
                      const wiItems = (wardrobeData?.items ?? []).filter((wi: any) => {
                        const roleMatch = wardrobeRecipient === "stock" ||
                          wi.effective_role_id == null ||
                          wi.effective_role_id === (wardrobeRecipient as CustomerEmployee).roleId;
                        if (!roleMatch) return false;
                        if (!wq) return true;
                        return (
                          (wi.product_name ?? wi.name ?? "").toLowerCase().includes(wq) ||
                          (wi.product_sku ?? "").toLowerCase().includes(wq)
                        );
                      });
                      if (wardrobeData && wiItems.length === 0) return (
                        <div className="py-8 text-center text-muted-foreground">
                          <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">{wq ? "No items match your search" : "No items for this role"}</p>
                        </div>
                      );
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {wiItems.map((wi: any) => {
                            const id = wi.id as number;
                            const pid = String(wi.product_id ?? "");
                            const byColour = wardrobeData?.sizesMap?.[pid];
                            const sizeOpts: string[] = byColour
                              ? sortSizesWithOrder([...new Set(Object.values(byColour).flat() as string[])], sizeOrder)
                              : [];
                            const sleeveOpts: string[] = wardrobeData?.sleevesMap?.[pid] ?? [];
                            const procs: any[] = (wardrobeData?.processes ?? []).filter((p: any) => p.finish_id === wi.finish_id);
                            const oneSize = sizeOpts.length === 0;
                            const isBulk = wardrobeBulkModes[id] ?? false;
                            const currentSize = wardrobeItemSizes[id] ?? "";
                            const currentSleeve = wardrobeItemSleeves[id] ?? "";
                            const currentQty = wardrobeItemQtys[id] ?? 0;
                            const bulkComboOpts = sleeveOpts.length > 0
                              ? sizeOpts.flatMap(s => sleeveOpts.map(sl => `${s}/${sl}`))
                              : sizeOpts;
                            // Use current product price + decoration extras; fall back to stored price if no product price.
                            const effectivePrice = wi.special_price != null
                              ? parseFloat(String(wi.special_price))
                              : wi.product_unit_price != null
                                ? parseFloat(String(wi.product_unit_price)) + getWiFinishExtra(wi)
                                : parseFloat(String(wi.unit_price ?? "0"));
                            const imageUrl = wi.variant_image_url ?? wi.product_image_url;
                            return (
                              <div key={id} className="rounded-xl border bg-card overflow-hidden flex flex-col">
                                {/* Image */}
                                <div className="aspect-square bg-white flex items-center justify-center border-b p-3">
                                  {imageUrl
                                    ? <img src={imageUrl} alt={wi.product_name ?? wi.name} className="w-full h-full object-contain" />
                                    : <ShoppingBag className="w-10 h-10 text-muted-foreground/20" />}
                                </div>
                                {/* Body */}
                                <div className="p-3 flex flex-col gap-2 flex-1">
                                  {/* Name + colour + price */}
                                  <div>
                                    <p className="font-semibold text-sm leading-snug line-clamp-2">{wi.product_name ?? wi.name}</p>
                                    {(wi.colour || wi.product_sku) && (
                                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{[wi.colour, wi.product_sku].filter(Boolean).join(" · ")}</p>
                                    )}
                                    {effectivePrice > 0 && (
                                      <p className="text-sm font-bold text-primary mt-1">{formatCurrency(effectivePrice)}</p>
                                    )}
                                  </div>
                                  {/* Finish + processes — matches customer portal card style */}
                                  {(wi.finish_name || procs.length > 0) && (
                                    <div className="space-y-1.5">
                                      {wi.finish_name && (
                                        <p className="text-xs font-bold text-foreground leading-snug">{wi.finish_name}</p>
                                      )}
                                      {procs.slice(0, 3).map((p: any) => {
                                        const typeColours: Record<string, string> = {
                                          embroidery: "bg-purple-100 text-purple-700 border-purple-200",
                                          print: "bg-blue-100 text-blue-700 border-blue-200",
                                          dtf: "bg-cyan-100 text-cyan-700 border-cyan-200",
                                          badge: "bg-amber-100 text-amber-700 border-amber-200",
                                          heat_transfer: "bg-orange-100 text-orange-700 border-orange-200",
                                        };
                                        const typeCls = typeColours[(p.process_type ?? "").toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
                                        const typeLabel = (p.process_type ?? "").replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase());
                                        return (
                                          <div key={p.process_id} className="flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5">
                                            {p.process_type && (
                                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${typeCls}`}>{typeLabel}</span>
                                            )}
                                            {p.item_finish_name && <span className="text-[10px] font-medium text-foreground/70 truncate">{p.item_finish_name}</span>}
                                            {p.placement && <span className="text-[10px] text-muted-foreground shrink-0">· {p.placement}</span>}
                                          </div>
                                        );
                                      })}
                                      {procs.length > 3 && (
                                        <p className="text-[10px] text-primary cursor-default">+{procs.length - 3} more…</p>
                                      )}
                                    </div>
                                  )}
                                  {/* Controls */}
                                  <div className="mt-auto flex flex-col gap-2">
                                    {/* Bulk toggle */}
                                    {!oneSize && sizeOpts.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => setWardrobeBulkModes(m => ({ ...m, [id]: !m[id] }))}
                                        className={cn(
                                          "w-full py-1.5 rounded-md text-xs font-semibold transition-colors border",
                                          isBulk
                                            ? "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                                            : "bg-[hsl(218,45%,19%)] text-white border-[hsl(218,45%,19%)] hover:bg-[hsl(218,45%,24%)]"
                                        )}
                                      >
                                        {isBulk ? "← Single item" : "Bulk Order"}
                                      </button>
                                    )}
                                    {oneSize ? (
                                      /* One size — just qty */
                                      <div className="flex items-center border rounded-md h-8 overflow-hidden">
                                        <button className="px-2 h-full text-muted-foreground hover:bg-muted/60 transition-colors" onClick={() => setWardrobeItemQtys(s => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) - 1) }))}><Minus className="w-3.5 h-3.5" /></button>
                                        <span className="flex-1 text-center text-sm font-semibold">{currentQty}</span>
                                        <button className="px-2 h-full text-muted-foreground hover:bg-muted/60 transition-colors" onClick={() => setWardrobeItemQtys(s => ({ ...s, [id]: (s[id] ?? 0) + 1 }))}><Plus className="w-3.5 h-3.5" /></button>
                                      </div>
                                    ) : isBulk ? (
                                      /* Bulk entry grid */
                                      (() => {
                                        const qtys = wardrobeBulkQtys[id] ?? {};
                                        if (sleeveOpts.length > 0) {
                                          const total = bulkComboOpts.reduce((s, k) => s + (qtys[k] ?? 0), 0);
                                          return (
                                            <div className="space-y-2">
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs border-collapse">
                                                  <thead>
                                                    <tr>
                                                      <th className="text-left pr-1 text-muted-foreground font-semibold py-0.5 text-[10px]">Size</th>
                                                      {sleeveOpts.map(sl => (
                                                        <th key={sl} className="text-center px-0.5 text-muted-foreground font-semibold py-0.5 text-[10px] min-w-[2rem]">{sl}</th>
                                                      ))}
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {sizeOpts.map(sz => (
                                                      <tr key={sz}>
                                                        <td className="pr-1 text-muted-foreground font-semibold py-0.5 text-[10px]">{sz}</td>
                                                        {sleeveOpts.map(sl => {
                                                          const combo = `${sz}/${sl}`;
                                                          return (
                                                            <td key={sl} className="px-0.5 py-0.5">
                                                              <input type="number" min={0} value={qtys[combo] || ""} placeholder="0"
                                                                onChange={e => { const v = parseInt(e.target.value, 10); setWardrobeBulkQtys(q => ({ ...q, [id]: { ...(q[id] ?? {}), [combo]: isNaN(v) || v < 0 ? 0 : v } })); }}
                                                                className="w-full h-7 text-center text-xs font-semibold rounded border border-input bg-transparent outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                              />
                                                            </td>
                                                          );
                                                        })}
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          );
                                        }
                                        {/* Columns chosen to avoid orphaned rows:
                                            1-4 → exact count; 5-6 → 3 cols; 7-8 → 4 cols; 9-10 → 5 cols */}
                                        const n = sizeOpts.length;
                                        const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
                                        return (
                                          <div className="grid gap-x-1 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                                            {sizeOpts.map(sz => (
                                              <div key={sz} className="flex flex-col items-center gap-0.5">
                                                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide leading-none">{abbreviateSizeLabel(sz)}</span>
                                                <input type="number" min={0} value={qtys[sz] || ""} placeholder="0"
                                                  onChange={e => { const v = parseInt(e.target.value, 10); setWardrobeBulkQtys(q => ({ ...q, [id]: { ...(q[id] ?? {}), [sz]: isNaN(v) || v < 0 ? 0 : v } })); }}
                                                  className="w-full h-7 text-center text-xs font-semibold rounded border border-input bg-transparent outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      /* Single item — size selector + qty (no per-card Add; use bottom button) */
                                      <>
                                        <Select value={currentSize} onValueChange={v => setWardrobeItemSizes(s => ({ ...s, [id]: v }))}>
                                          <SelectTrigger className="h-8 text-sm w-full">
                                            <SelectValue placeholder="Select size" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {sizeOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                        {sleeveOpts.length > 0 && (
                                          <Select value={currentSleeve} onValueChange={v => setWardrobeItemSleeves(s => ({ ...s, [id]: v }))}>
                                            <SelectTrigger className="h-8 text-sm w-full">
                                              <SelectValue placeholder="Fit / Length" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {sleeveOpts.map(sl => <SelectItem key={sl} value={sl}>{sl}</SelectItem>)}
                                            </SelectContent>
                                          </Select>
                                        )}
                                        <div className="flex items-center border rounded-md h-8 overflow-hidden">
                                          <button className="px-2 h-full text-muted-foreground hover:bg-muted/60 transition-colors" onClick={() => setWardrobeItemQtys(s => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) - 1) }))}><Minus className="w-3.5 h-3.5" /></button>
                                          <span className="flex-1 text-center text-sm font-semibold">{currentQty}</span>
                                          <button className="px-2 h-full text-muted-foreground hover:bg-muted/60 transition-colors" onClick={() => setWardrobeItemQtys(s => ({ ...s, [id]: (s[id] ?? 0) + 1 }))}><Plus className="w-3.5 h-3.5" /></button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </TabsContent>

              {/* ── CUSTOM ITEM TAB ────────────────────────────────────────── */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto mt-0 pt-3 data-[state=inactive]:hidden">
                <div className="grid gap-5">
                  {/* Product picker */}
                  <div className="grid gap-2">
                    <Label>Product</Label>
                    <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {selectedProduct ? selectedProduct.name : "Search products..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Type product name or SKU..." />
                          <CommandList>
                            <CommandEmpty>No products found.</CommandEmpty>
                            <CommandGroup>
                              {products?.map(p => (
                                <CommandItem key={p.id} value={`${p.name} ${p.sku ?? ""}`} onSelect={() => handleProductSelect(p.id)}>
                                  <Check className={cn("mr-2 h-4 w-4", item.productId === p.id ? "opacity-100" : "opacity-0")} />
                                  <span className="flex-1">{p.name}</span>
                                  {p.sku && <span className="text-xs text-muted-foreground mr-2">{p.sku}</span>}
                                  <span className="text-xs font-semibold">{formatCurrency(p.unitPrice)}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Colour + Size */}
                  {item.productId && (colours.length > 0 || sizes.length > 0) && (() => {
                    const historyById = item.productId ? lastOrderedSizes.byProductId[item.productId] : null;
                    const historyByName = lastOrderedSizes.byProductName[item.productName];
                    const historySize = historyById?.size ?? historyByName?.size ?? null;
                    const profileSize = selectedEmployee?.sizes?.find(s => s.label === item.productName)?.size ?? null;
                    const suggestedSize = historySize ?? profileSize;
                    const isFromHistory = !!historySize;
                    return (
                      <div className="grid gap-4">
                        {colours.length > 0 && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                              <Palette className="w-3 h-3" /> Colour <span className="text-destructive ml-0.5">*</span>
                            </Label>
                            <Select value={item.colour || ""} onValueChange={v => setItem(i => ({ ...i, colour: v }))}>
                              <SelectTrigger className={!item.colour ? "border-destructive/50" : ""}>
                                <SelectValue placeholder="Select a colour…" />
                              </SelectTrigger>
                              <SelectContent>
                                {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {sizes.length > 0 && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                              <Ruler className="w-3 h-3" /> Sizes <span className="text-destructive ml-0.5">*</span>
                            </Label>
                            <div className="flex flex-col gap-2">
                              {sizeRows.map((row, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <Select value={row.size || ""} onValueChange={v => setSizeRows(r => r.map((x, i) => i === idx ? { ...x, size: v } : x))}>
                                    <SelectTrigger className={`flex-1 ${!row.size ? "border-destructive/50" : ""}`}>
                                      <SelectValue placeholder="Select size…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {sizes.map(s => (
                                        <SelectItem key={s} value={s}>
                                          <span className="flex items-center gap-2">
                                            {s}
                                            {s === suggestedSize && (
                                              <span className="text-[10px] text-emerald-700 font-medium">
                                                {isFromHistory ? "last ordered" : "saved size"}
                                              </span>
                                            )}
                                          </span>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    type="number" min="1"
                                    value={row.qty}
                                    onChange={e => setSizeRows(r => r.map((x, i) => i === idx ? { ...x, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))}
                                    className="w-20 text-center"
                                  />
                                  {sizeRows.length > 1 && (
                                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setSizeRows(r => r.filter((_, i) => i !== idx))}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              <Button variant="outline" size="sm" className="w-fit gap-1.5 text-xs" onClick={() => setSizeRows(r => [...r, { size: "", qty: 1 }])}>
                                <Plus className="w-3 h-3" /> Add another size
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Finish */}
                  <div className="grid gap-2">
                    <Label className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Finish</Label>
                    <Select value={item.finishId ? item.finishId.toString() : "plain"} onValueChange={handleFinishSelect}>
                      <SelectTrigger><SelectValue placeholder="Plain (no finish)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plain">Plain (no finish)</SelectItem>
                        {customerFinishes?.map(f => (
                          <SelectItem key={f.id} value={f.id.toString()}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              {f.totalCost > 0 && <span className="text-xs text-muted-foreground">+{formatCurrency(f.totalCost)}</span>}
                            </span>
                          </SelectItem>
                        ))}
                        {(!customerFinishes || customerFinishes.length === 0) && (
                          <SelectItem value="plain" disabled>No finishes set up for this customer</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {item.finishId && item.finishCost > 0 && (
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 space-y-0.5">
                        <div className="flex justify-between"><span>Garment</span><span className="tabular-nums">{formatCurrency(parseFloat(item.baseUnitPrice) || 0)}</span></div>
                        <div className="flex justify-between text-emerald-700"><span>Finish ({item.finishName})</span><span className="tabular-nums">+{formatCurrency(item.finishCost)}</span></div>
                        <div className="flex justify-between font-semibold text-foreground border-t border-border/40 pt-0.5 mt-0.5"><span>Unit price</span><span className="tabular-nums">{formatCurrency(parseFloat(item.unitPrice) || 0)}</span></div>
                      </div>
                    )}
                  </div>

                  {/* Recipient */}
                  <div className="grid gap-3">
                    <Label>Ordered for</Label>
                    <RadioGroup
                      value={item.recipientType}
                      onValueChange={(v) => {
                        setItem(i => ({ ...i, recipientType: v as "stock" | "person", recipientName: "" }));
                        if (v !== "person") { setSelectedEmployee(null); setIsNewPerson(false); }
                      }}
                      className="flex gap-6"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="stock" id="for-stock" />
                        <Label htmlFor="for-stock" className="font-normal cursor-pointer flex items-center gap-1"><Archive className="w-3.5 h-3.5 text-muted-foreground" /> Stock</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="person" id="for-person" />
                        <Label htmlFor="for-person" className="font-normal cursor-pointer flex items-center gap-1"><User className="w-3.5 h-3.5 text-muted-foreground" /> Specific person</Label>
                      </div>
                    </RadioGroup>
                    {item.recipientType === "person" && (
                      <div className="grid gap-2">
                        {customerEmployees && customerEmployees.length > 0 && (
                          <Select onValueChange={handleEmployeeSelect} value={selectedEmployee ? selectedEmployee.id.toString() : isNewPerson ? "__new__" : ""}>
                            <SelectTrigger><SelectValue placeholder="Pick from employees..." /></SelectTrigger>
                            <SelectContent>
                              {customerEmployees.map(e => (
                                <SelectItem key={e.id} value={e.id.toString()}>
                                  <div className="flex flex-col items-start">
                                    <span>{[e.firstName, e.lastName].filter(Boolean).join(" ")}</span>
                                    {(e.jobTitle || e.roleName) && <span className="text-xs text-muted-foreground">{[e.jobTitle, e.roleName].filter(Boolean).join(" · ")}</span>}
                                  </div>
                                </SelectItem>
                              ))}
                              <SelectItem value="__new__">+ Add new person...</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {selectedEmployee?.sizes && selectedEmployee.sizes.length > 0 && (
                          <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                            <p className="font-medium mb-1">Saved sizes for {selectedEmployee.firstName}:</p>
                            <div className="flex flex-wrap gap-2">
                              {selectedEmployee.sizes.map(s => (
                                <span key={s.id} className="bg-white border border-blue-200 rounded px-2 py-0.5 font-medium">{s.label}: {s.size}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <Input
                          placeholder={customerEmployees && customerEmployees.length > 0 ? "Or type a name..." : "Recipient name"}
                          value={item.recipientName}
                          onChange={e => setItem(i => ({ ...i, recipientName: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>

                  {/* Qty + Price — qty hidden when using per-row size quantities */}
                  <div className={`grid gap-4 ${sizes.length > 0 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {sizes.length === 0 && (
                      <div className="grid gap-2">
                        <Label htmlFor="qty">Quantity</Label>
                        <Input id="qty" type="number" min="1" value={item.quantity} onChange={e => setItem(i => ({ ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="price">Unit Price (£)</Label>
                      <Input id="price" type="number" step="1" min="0" value={item.unitPrice} onChange={e => setItem(i => ({ ...i, unitPrice: e.target.value }))} />
                    </div>
                  </div>

                  {/* VAT Rate */}
                  <div className="grid gap-2">
                    <Label className="text-sm">VAT Rate</Label>
                    <RadioGroup
                      value={String(item.vatRate)}
                      onValueChange={(v) => setItem(i => ({ ...i, vatRate: parseFloat(v) }))}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.2" id="vat-20" />
                        <Label htmlFor="vat-20" className="font-normal cursor-pointer">20% (standard)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.05" id="vat-5" />
                        <Label htmlFor="vat-5" className="font-normal cursor-pointer">5% (reduced)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0" id="vat-0" />
                        <Label htmlFor="vat-0" className="font-normal cursor-pointer">0% (zero-rated)</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Price break info for products with tiered pricing */}
                  {item.productId && (() => {
                    const prod = products?.find(p => p.id === item.productId);
                    const priceBreaks = (prod as any)?.priceBreaks as { qty: number; price: number }[] | null;
                    const minOrderQty = (prod as any)?.minOrderQty as number | null;
                    if (!priceBreaks || priceBreaks.length === 0) return null;
                    const totalQty = sizes.length > 0 ? sizeRows.reduce((s, r) => s + (r.qty || 0), 0) : item.quantity;
                    const sorted = [...priceBreaks]
                      .map(t => ({ qty: Number(t.qty), price: parseFloat(String(t.price)) }))
                      .filter(t => !isNaN(t.price))
                      .sort((a, b) => a.qty - b.qty);
                    const nextTier = sorted.find(t => t.qty > totalQty);
                    const activeTier = sorted.filter(t => t.qty <= totalQty).at(-1);
                    const belowMin = minOrderQty != null && totalQty < minOrderQty;
                    return (
                      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-indigo-800">Price tiers (total qty):</span>
                          {sorted.map(t => (
                            <span key={t.qty} className={`px-1.5 py-0.5 rounded font-medium ${t === activeTier ? "bg-indigo-600 text-white" : "bg-white border border-indigo-200 text-indigo-700"}`}>
                              {t.qty}+ = £{t.price.toFixed(2)}
                            </span>
                          ))}
                        </div>
                        {belowMin && (
                          <p className="text-amber-700 font-medium">⚠ Min. order qty is {minOrderQty} — current total is {totalQty}.</p>
                        )}
                        {nextTier && !belowMin && (
                          <p className="text-indigo-600">Add {nextTier.qty - totalQty} more to unlock £{nextTier.price.toFixed(2)}/unit.</p>
                        )}
                      </div>
                    );
                  })()}

                  {item.unitPrice && (
                    <div className="flex justify-end text-sm text-muted-foreground">
                      {sizes.length > 0 && sizeRows.length > 0 ? (
                        <>
                          {sizeRows.length > 1 && <span className="mr-2 text-xs">{sizeRows.length} lines ·</span>}
                          Order total: <span className="font-semibold text-foreground ml-1">{formatCurrency(sizeRows.reduce((s, r) => s + r.qty * (parseFloat(item.unitPrice) || 0), 0))}</span>
                        </>
                      ) : (
                        <>Line total: <span className="font-semibold text-foreground ml-1">{formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}</span></>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── SERVICE TAB ────────────────────────────────────────────── */}
              <TabsContent value="service" className="flex-1 overflow-y-auto mt-0 pt-3 data-[state=inactive]:hidden">
                <div className="grid gap-5">
                  {/* Service product picker */}
                  <div className="grid gap-2">
                    <Label>Service</Label>
                    {serviceProducts && serviceProducts.length > 0 ? (
                      <Popover open={serviceProductSearchOpen} onOpenChange={setServiceProductSearchOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                            {item.productId ? (serviceProducts.find(p => p.id === item.productId)?.name ?? item.productName) : item.productName || "Search service catalogue…"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Type service name…" />
                            <CommandList>
                              <CommandEmpty>No matching service.</CommandEmpty>
                              <CommandGroup>
                                {serviceProducts.map(p => (
                                  <CommandItem key={p.id} value={p.name} onSelect={() => { handleProductSelect(p.id); setServiceProductSearchOpen(false); }}>
                                    <Check className={cn("mr-2 h-4 w-4", item.productId === p.id ? "opacity-100" : "opacity-0")} />
                                    <span className="flex-1">{p.name}</span>
                                    {p.unitPrice != null && <span className="text-xs font-semibold text-muted-foreground">{formatCurrency(p.unitPrice)}</span>}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                        No service products in catalogue yet — use the field below to add a free-text service line.
                      </p>
                    )}
                    {/* Free-text name — always shown; clears catalog selection when edited */}
                    <Input
                      placeholder="Service name *"
                      value={item.productName}
                      onChange={e => setItem(i => ({ ...i, productName: e.target.value, productId: undefined as any }))}
                    />
                  </div>

                  {/* Description / scope */}
                  <div className="grid gap-2">
                    <Label>Description <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    <Input
                      placeholder="e.g. 50 logos, front + back, 2-colour"
                      value={item.finishName ?? ""}
                      onChange={e => setItem(i => ({ ...i, finishName: e.target.value }))}
                    />
                  </div>

                  {/* Qty + Price */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="svc-qty">Quantity</Label>
                      <Input id="svc-qty" type="number" min="1" value={item.quantity} onChange={e => setItem(i => ({ ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="svc-price">Unit Price (£)</Label>
                      <Input id="svc-price" type="number" step="1" min="0" value={item.unitPrice} onChange={e => setItem(i => ({ ...i, unitPrice: e.target.value }))} />
                    </div>
                  </div>

                  {/* VAT Rate */}
                  <div className="grid gap-2">
                    <Label className="text-sm">VAT Rate</Label>
                    <RadioGroup value={String(item.vatRate)} onValueChange={(v) => setItem(i => ({ ...i, vatRate: parseFloat(v) }))} className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.2" id="svc-vat-20" />
                        <Label htmlFor="svc-vat-20" className="font-normal cursor-pointer">20% (standard)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.05" id="svc-vat-5" />
                        <Label htmlFor="svc-vat-5" className="font-normal cursor-pointer">5% (reduced)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0" id="svc-vat-0" />
                        <Label htmlFor="svc-vat-0" className="font-normal cursor-pointer">0% (zero-rated)</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {item.unitPrice && (
                    <div className="flex justify-end text-sm text-muted-foreground">
                      Line total: <span className="font-semibold text-foreground ml-1">{formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}</span>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="shrink-0 border-t border-border/40 pt-4 mt-2">
              <Button variant="outline" onClick={resetDialog}>Cancel</Button>
              <Button
                onClick={async () => {
                  // Wardrobe tab — new recipient form open: save the employee then add in one step
                  if (dialogTab === "wardrobe" && addRecipientOpen && addRecipientForm.firstName.trim()) {
                    setAddRecipientSaving(true);
                    try {
                      const newEmp = await apiFetch(`/customers/${customerId}/employees`, {
                        method: "POST",
                        body: JSON.stringify({
                          firstName: addRecipientForm.firstName.trim(),
                          lastName: addRecipientForm.lastName.trim() || null,
                          jobTitle: addRecipientForm.jobTitle.trim() || null,
                          teamId: addRecipientForm.teamId ?? null,
                        }),
                      });
                      await queryClient.invalidateQueries({ queryKey: ["customer-employees", customerId] });
                      setAddRecipientOpen(false);
                      setAddRecipientForm({ firstName: "", lastName: "", jobTitle: "", teamId: null });
                      await handleWardrobeAddAll(newEmp as CustomerEmployee);
                    } catch {
                      toast({ title: "Could not create recipient", variant: "destructive" });
                    } finally {
                      setAddRecipientSaving(false);
                    }
                    return;
                  }
                  dialogTab === "wardrobe" ? handleWardrobeAddAll() : handleAddItem();
                }}
                disabled={
                  addItemMutation.isPending || isAddingMulti || addRecipientSaving ||
                  (dialogTab === "wardrobe"
                    ? wardrobeRecipient === null && !(addRecipientOpen && addRecipientForm.firstName.trim())
                    : !item.unitPrice ||
                      (dialogTab === "service" ? !item.productName.trim() : !item.productId) ||
                      (colours.length > 0 && dialogTab === "custom" && !item.colour) ||
                      (sizes.length > 0 && dialogTab === "custom" && sizeRows.some(r => !r.size))
                  )
                }
              >
                {(addItemMutation.isPending || isAddingMulti)
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Adding...</>
                  : dialogTab !== "wardrobe" && sizeRows.length > 1
                    ? `Add ${sizeRows.length} lines to Order`
                    : "Add to Order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isSendToProductionOpen} onOpenChange={setIsSendToProductionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <ClipboardList className="w-5 h-5" />
              Send to Production
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will create a production worksheet for all items that don't need purchasing. It will appear in <strong>Pre-Production</strong> and move to Work in Progress when decoration begins.
            </p>
            {order.items && (() => {
              const eligible = (order.items as any[]).filter((oi: any) => !oi.purchaseRequired && !oi.isService && oi.stock_status !== 'complete');
              // Group by productName → colour → size → qty
              const productMap = new Map<string, Map<string, Map<string, number>>>();
              for (const oi of eligible) {
                if (!productMap.has(oi.productName)) productMap.set(oi.productName, new Map());
                const cm = productMap.get(oi.productName)!;
                const c = oi.colour ?? "";
                if (!cm.has(c)) cm.set(c, new Map());
                const sm = cm.get(c)!;
                sm.set(oi.size ?? "", (sm.get(oi.size ?? "") ?? 0) + oi.quantity);
              }
              return (
                <div className="space-y-3">
                  {Array.from(productMap.entries()).map(([productName, colourMap]) => {
                    const allSizes = sortSizes([...new Set(Array.from(colourMap.values()).flatMap(sm => [...sm.keys()]))]);
                    const hasSizes = allSizes.some(s => s !== "");
                    const hasColours = colourMap.size > 1 || [...colourMap.keys()][0] !== "";
                    return (
                      <div key={productName}>
                        <p className="text-xs font-semibold text-foreground mb-1">{productName}</p>
                        <div className="overflow-x-auto rounded-lg border border-green-200">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-green-50 border-b border-green-200">
                                {hasColours && <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Colour</th>}
                                {hasSizes
                                  ? allSizes.map(s => <th key={s} className="text-center px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">{s || "—"}</th>)
                                  : <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Qty</th>}
                                <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from(colourMap.entries()).map(([colour, sizeMap]) => {
                                const rowTotal = Array.from(sizeMap.values()).reduce((s, q) => s + q, 0);
                                return (
                                  <tr key={colour} className="border-b border-green-50 last:border-0">
                                    {hasColours && <td className="px-2 py-1.5 font-medium whitespace-nowrap">{colour || "—"}</td>}
                                    {hasSizes
                                      ? allSizes.map(s => { const q = sizeMap.get(s); return <td key={s} className="text-center px-2 py-1.5">{q ? <span className="font-semibold">{q}</span> : <span className="text-muted-foreground/30">—</span>}</td>; })
                                      : <td className="text-center px-2 py-1.5 font-semibold">{rowTotal}</td>}
                                    <td className="text-center px-2 py-1.5 font-semibold">{rowTotal}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Production Notes (optional)</Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Any special instructions for the production team..."
                value={productionNotes}
                onChange={(e) => setProductionNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSendToProductionOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
              onClick={() => {
                if (!order.items) return;
                const eligibleIds = order.items
                  .filter((oi: any) => !oi.purchaseRequired && !oi.isService && oi.stock_status !== 'complete')
                  .map((oi: { id: number }) => oi.id);
                sendToProductionMutation.mutate(eligibleIds);
              }}
              disabled={sendToProductionMutation.isPending}
            >
              {sendToProductionMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><ClipboardList className="w-4 h-4" /> Create Worksheet</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmOrderDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        order={{
          id: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId ?? null,
          customerName: order.customerName ?? null,
          customerEmail: (order as any).customerEmail ?? null,
          status: order.status,
          totalAmount: order.totalAmount,
          requiredDate: (order as any).requiredDate ?? null,
          shippingMethod: (order as any).shippingMethod ?? null,
          items: order.items,
        }}
        customerDefaultShipping={(wardrobeData as any)?.defaultShippingOption ?? null}
        onConfirmed={() => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        }}
      />

      <SendAcknowledgementDialog
        open={sendAckOpen}
        onOpenChange={setSendAckOpen}
        order={{
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName ?? null,
          totalAmount: order.totalAmount,
          status: order.status,
          customerEmail: (order as any).customerEmail ?? null,
        }}
        onSent={() => {
          queryClient.invalidateQueries({ queryKey: ["order-email-logs", orderId] });
        }}
      />

      {/* Return to Stock dialog */}
      <Dialog open={returnToStockOpen} onOpenChange={open => { if (!open) setReturnToStockOpen(false); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <RotateCcw className="w-5 h-5" />
              Return Items to Stock
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Select which items came back and how they should be booked in.
              <br />
              <span className="font-medium text-foreground">Plain</span> — unbranded garment back to the general stock pool.{" "}
              <span className="font-medium text-foreground">Finished</span> — decorated/embroidered item stored against this customer only.
            </p>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-6 px-6 py-2 space-y-2">
            {(order.items ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No items on this order.</p>
            )}
            {(order.items ?? []).map(item => {
              const sel = returnSelections[item.id];
              if (!sel) return null;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-3 space-y-2 transition-colors",
                    sel.selected ? "border-emerald-300 bg-emerald-50" : "border-border bg-background"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-emerald-600 cursor-pointer"
                      checked={sel.selected}
                      onChange={e => setReturnSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], selected: e.target.checked } }))}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{item.productName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[item.colour, item.size, (item as any).finishName].filter(Boolean).join(" · ")}
                        {" · "}Qty ordered: {item.quantity}
                      </p>
                    </div>
                  </div>

                  {sel.selected && (
                    <div className="pl-7 space-y-2">
                      {/* Quantity */}
                      <div className="flex items-center gap-3">
                        <Label className="text-xs w-24 shrink-0">Qty returning</Label>
                        <Input
                          type="number"
                          min={1}
                          max={item.quantity}
                          value={sel.quantity}
                          onChange={e => {
                            const v = Math.min(Math.max(1, parseInt(e.target.value, 10) || 1), item.quantity);
                            setReturnSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], quantity: v } }));
                          }}
                          className="w-24 h-8 text-sm"
                        />
                      </div>

                      {/* Type */}
                      <div className="flex items-center gap-3">
                        <Label className="text-xs w-24 shrink-0">Stock type</Label>
                        <RadioGroup
                          value={sel.type}
                          onValueChange={(v: "plain" | "finished") =>
                            setReturnSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], type: v } }))
                          }
                          className="flex gap-4"
                        >
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="plain" id={`plain-${item.id}`} />
                            <Label htmlFor={`plain-${item.id}`} className="text-xs font-normal cursor-pointer">Plain (general stock)</Label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <RadioGroupItem value="finished" id={`finished-${item.id}`} />
                            <Label htmlFor={`finished-${item.id}`} className="text-xs font-normal cursor-pointer">Finished (customer only)</Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {/* Unit price — only for finished */}
                      {sel.type === "finished" && (
                        <div className="flex items-center gap-3">
                          <Label className="text-xs w-24 shrink-0">Unit price (£)</Label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={sel.unitPrice}
                            onChange={e => setReturnSelections(prev => ({ ...prev, [item.id]: { ...prev[item.id], unitPrice: e.target.value } }))}
                            className="w-28 h-8 text-sm"
                            placeholder="e.g. 25"
                          />
                          <span className="text-xs text-muted-foreground">for the customer wardrobe entry</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => setReturnToStockOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              disabled={
                returnToStockMutation.isPending ||
                !Object.values(returnSelections).some(s => s.selected) ||
                Object.entries(returnSelections).some(([, s]) => s.selected && s.type === "finished" && (parseFloat(s.unitPrice) < 0 || s.unitPrice === ""))
              }
              onClick={() => {
                const items = Object.entries(returnSelections)
                  .filter(([, s]) => s.selected)
                  .map(([idStr, s]) => ({
                    orderItemId: parseInt(idStr, 10),
                    quantity: s.quantity,
                    type: s.type,
                    ...(s.type === "finished" ? { unitPrice: parseFloat(s.unitPrice) || 0 } : {}),
                  }));
                returnToStockMutation.mutate(items);
              }}
            >
              {returnToStockMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Booking in…</>
                : <><RotateCcw className="w-4 h-4" />Book into stock</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete order confirmation */}
      <Dialog open={deleteOrderConfirmOpen} onOpenChange={setDeleteOrderConfirmOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="w-5 h-5" />
              Delete Order {order.orderNumber}?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the order and all its line items. This cannot be undone.
            </p>
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm">
              <p className="font-medium text-red-800">{order.customerName}</p>
              <p className="text-red-600 text-xs mt-0.5">{order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? "s" : ""} · {formatCurrency(order.totalAmount)}</p>
            </div>
            {order.status === "confirmed" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                This order is confirmed — any stock that was allocated to it will be returned to your stock levels.
              </p>
            )}
            {(order.status === "shipped" || order.status === "delivered") && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                This order has already been {order.status} — stock will not be restored.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrderConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteOrderMutation.mutate()}
              disabled={deleteOrderMutation.isPending}
            >
              {deleteOrderMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Deleting…</> : "Yes, delete order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete item — smart PO-aware dialog */}
      {(() => {
        if (!deletingItem) return null;
        const { poInfo } = deletingItem;
        const draftPOs = poInfo.filter(p => p.status === "draft");
        const orderedPOs = poInfo.filter(p => p.status !== "draft");
        const hasPoLink = poInfo.length > 0;
        return (
          <AlertDialog open onOpenChange={open => { if (!open) setDeletingItem(null); }}>
            <AlertDialogContent className="sm:max-w-[420px]">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove item from order?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    {!hasPoLink && (
                      <p>This will permanently remove the item from the order.</p>
                    )}
                    {draftPOs.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
                        <p className="font-medium text-amber-800">This item is on a draft purchase order:</p>
                        {draftPOs.map(p => (
                          <p key={p.poNumber} className="font-mono text-amber-700 text-xs">{p.poNumber}</p>
                        ))}
                        <p className="text-amber-700 mt-1">Do you also want to remove it from the PO?</p>
                      </div>
                    )}
                    {orderedPOs.length > 0 && (
                      <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-1">
                        <p className="font-medium text-violet-800">This item has already been ordered:</p>
                        {orderedPOs.map(p => (
                          <p key={p.poNumber} className="font-mono text-violet-700 text-xs">{p.poNumber} <span className="capitalize">({p.status})</span></p>
                        ))}
                        <p className="text-violet-700 mt-1">The ordered stock will be received into stock when the PO is delivered.</p>
                      </div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-wrap gap-2">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {draftPOs.length > 0 ? (
                  <>
                    <Button variant="outline" onClick={() => confirmDeleteItem(false)}>
                      Remove item only
                    </Button>
                    <Button variant="destructive" onClick={() => confirmDeleteItem(true)}>
                      Remove item &amp; from PO
                    </Button>
                  </>
                ) : (
                  <AlertDialogAction onClick={() => confirmDeleteItem(false)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Remove item
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}

      {/* Edit size / colour */}
      <Dialog open={!!editingSizeColour} onOpenChange={open => { if (!open) setEditingSizeColour(null); }}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler className="w-4 h-4" /> Correct size / colour
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-colour">Colour</Label>
              <Input
                id="edit-colour"
                value={editingSizeColour?.colour ?? ""}
                onChange={e => setEditingSizeColour(s => s && ({ ...s, colour: e.target.value }))}
                placeholder="e.g. Navy/Burgundy"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-size">Size</Label>
              <Input
                id="edit-size"
                value={editingSizeColour?.size ?? ""}
                onChange={e => setEditingSizeColour(s => s && ({ ...s, size: e.target.value }))}
                placeholder="e.g. 2XL"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSizeColour(null)}>Cancel</Button>
            <Button
              disabled={updateItemSizeColourMutation.isPending}
              onClick={() => editingSizeColour && updateItemSizeColourMutation.mutate(editingSizeColour)}
            >
              {updateItemSizeColourMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Add Bundle dialog ── */}
      <Dialog open={isAddBundleOpen} onOpenChange={open => { if (!open) { setIsAddBundleOpen(false); setAddBundleId(null); setAddBundleWearerName(""); setCompOverrides({}); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package2 className="w-5 h-5 text-primary" /> Add Bundle
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Bundle</Label>
              <Select value={addBundleId?.toString() ?? ""} onValueChange={v => { setAddBundleId(parseInt(v)); setCompOverrides({}); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bundle…" />
                </SelectTrigger>
                <SelectContent>
                  {bundles.filter(b => b.is_active).map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.name}
                      <span className="ml-2 text-muted-foreground text-xs">£{parseFloat(String(b.price)).toFixed(2)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {addBundleId != null && (() => {
                const sel = bundles.find(b => b.id === addBundleId);
                return sel ? (
                  <p className="text-xs text-muted-foreground">{sel.component_count} component item{sel.component_count !== 1 ? "s" : ""} will be added at £0 each</p>
                ) : null;
              })()}
            </div>
            <div className="space-y-1.5">
              <Label>Wearer Name</Label>
              <Input
                placeholder="e.g. John Smith"
                value={addBundleWearerName}
                onChange={e => setAddBundleWearerName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Who this bundle is for — optional, but helps identify each set</p>
            </div>
            {/* ── Per-component colour/size pickers ── */}
            {bundleDetails?.components && bundleDetails.components.filter(c => !c.p_is_service && c.variants && c.variants.length > 0).length > 0 && (
              <div className="space-y-2">
                <Label>Component Variations</Label>
                <div className="space-y-2">
                  {bundleDetails.components.filter(c => !c.p_is_service && c.variants && c.variants.length > 0).map(comp => {
                    const colours = [...new Set(comp.variants!.map(v => v.colour).filter(Boolean))].sort();
                    const selectedColour = compOverrides[comp.id]?.colour ?? "";
                    const sizesForColour = [...new Set(comp.variants!.filter(v => v.colour === selectedColour).map(v => v.size).filter(Boolean))];
                    const allVariantSizes = [...new Set(comp.variants!.map(v => v.size).filter(Boolean))];
                    const sizesToShow = sizesForColour.length > 0 ? sizesForColour : allVariantSizes.length > 0 ? allVariantSizes : DEFAULT_CLOTHING_SIZES;
                    const selectedSize = compOverrides[comp.id]?.size ?? "";
                    return (
                      <div key={comp.id} className="border rounded-lg p-3 bg-muted/20 space-y-2">
                        <p className="text-sm font-medium leading-tight">
                          {comp.resolved_name}
                          {comp.quantity > 1 && <span className="text-muted-foreground font-normal ml-1">(×{comp.quantity} per bundle)</span>}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Colour</Label>
                            <Select
                              value={selectedColour}
                              onValueChange={v => setCompOverrides(prev => ({ ...prev, [comp.id]: { ...prev[comp.id], colour: v, size: "" } }))}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="— select —" />
                              </SelectTrigger>
                              <SelectContent>
                                {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Size</Label>
                            <Select
                              value={selectedSize}
                              disabled={colours.length > 0 && !selectedColour}
                              onValueChange={v => setCompOverrides(prev => ({ ...prev, [comp.id]: { ...prev[comp.id], size: v } }))}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder={colours.length > 0 && !selectedColour ? "Pick colour first" : "— select —"} />
                              </SelectTrigger>
                              <SelectContent>
                                {sizesToShow.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {customerFinishes && customerFinishes.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Finish</Label>
                            <Select
                              value={compOverrides[comp.id]?.finishId != null ? String(compOverrides[comp.id].finishId) : (comp.finish_id != null ? String(comp.finish_id) : "__none__")}
                              onValueChange={v => {
                                if (v === "__none__") {
                                  setCompOverrides(prev => ({ ...prev, [comp.id]: { ...prev[comp.id], finishId: null, finishName: null } }));
                                } else {
                                  const f = customerFinishes.find((f: any) => String(f.id) === v);
                                  setCompOverrides(prev => ({ ...prev, [comp.id]: { ...prev[comp.id], finishId: f?.id ?? null, finishName: f?.name ?? null } }));
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="— no finish —" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__"><span className="text-muted-foreground">— no finish —</span></SelectItem>
                                {customerFinishes.map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddBundleOpen(false); setAddBundleId(null); setAddBundleWearerName(""); setCompOverrides({}); }}>Done</Button>
            <Button
              disabled={addBundleId == null || addBundleMutation.isPending}
              onClick={() => addBundleId != null && addBundleMutation.mutate({
                bundleId: addBundleId,
                wearerName: addBundleWearerName || undefined,
                componentOverrides: Object.entries(compOverrides)
                  .filter(([, ov]) => ov.colour || ov.size || ov.finishId != null)
                  .map(([id, ov]) => ({ componentId: parseInt(id), colour: ov.colour || undefined, size: ov.size || undefined, finishId: ov.finishId ?? undefined, finishName: ov.finishName ?? undefined })),
              })}
            >
              {addBundleMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Adding…</>
                : addBundleWearerName ? `Add for ${addBundleWearerName}` : "Add Bundle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Wardrobe bulk price-break prompt ──────────────────────────────── */}
      <Dialog open={!!wardrobePBDialog} onOpenChange={open => { if (!open) setWardrobePBDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgePercent className="w-5 h-5 text-green-600" />
              Quantity discounts available
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              The quantities you've ordered qualify for special pricing. Select the discounts you'd like to apply.
            </p>
          </DialogHeader>
          {wardrobePBDialog && (
            <div className="space-y-2 py-1 max-h-72 overflow-y-auto pr-1">
              {wardrobePBDialog.suggestions.map(s => {
                const checked = wardrobePBDialog.applySet.has(s.wiId);
                const saving = (s.currentPrice - s.breakPrice) * s.totalQty;
                return (
                  <button
                    key={s.wiId}
                    type="button"
                    onClick={() => setWardrobePBDialog(prev => {
                      if (!prev) return prev;
                      const next = new Set(prev.applySet);
                      if (next.has(s.wiId)) next.delete(s.wiId); else next.add(s.wiId);
                      return { ...prev, applySet: next };
                    })}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${checked ? "border-green-500 bg-green-50/60 dark:bg-green-950/30" : "border-border bg-muted/30"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked ? "bg-green-600 border-green-600" : "border-muted-foreground/40"}`}>
                        {checked && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-white fill-current"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{s.productName}{s.colour ? ` · ${s.colour}` : ""}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{s.totalQty} items ordered — qualifies for {s.tierQty}+ price tier</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-sm line-through text-muted-foreground">£{s.currentPrice.toFixed(2)}</span>
                          <span className="text-base font-bold text-green-600">£{s.breakPrice.toFixed(2)}</span>
                          <span className="text-[11px] text-green-700 font-medium ml-auto">saves £{saving.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                if (!wardrobePBDialog) return;
                const { lines, recipientCtx } = wardrobePBDialog;
                setWardrobePBDialog(null);
                doPostWardrobeLines(lines, recipientCtx, new Map());
              }}
            >
              Keep original prices
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={isAddingMulti || (wardrobePBDialog?.applySet.size ?? 0) === 0}
              onClick={() => {
                if (!wardrobePBDialog) return;
                const { lines, recipientCtx, applySet, suggestions } = wardrobePBDialog;
                const overrides = new Map<number, number>(
                  suggestions
                    .filter(s => applySet.has(s.wiId))
                    .map(s => [s.wiId, s.breakPrice])
                );
                setWardrobePBDialog(null);
                doPostWardrobeLines(lines, recipientCtx, overrides);
              }}
            >
              {isAddingMulti
                ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Adding…</>
                : wardrobePBDialog?.applySet.size === wardrobePBDialog?.suggestions.length
                  ? "Apply all discounts & add"
                  : `Apply ${wardrobePBDialog?.applySet.size ?? 0} discount${(wardrobePBDialog?.applySet.size ?? 0) !== 1 ? "s" : ""} & add`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Price-break apply dialog ───────────────────────────────────────── */}
      <Dialog open={!!priceBreakPrompt} onOpenChange={open => { if (!open) setPriceBreakPrompt(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgePercent className="w-5 h-5 text-green-600" />
              Special price available
            </DialogTitle>
          </DialogHeader>
          {priceBreakPrompt && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                You now have <span className="font-semibold text-foreground">{priceBreakPrompt.totalQty}×</span> {priceBreakPrompt.productName} on this order,
                qualifying for the <span className="font-semibold text-foreground">{priceBreakPrompt.tierQty}+</span> price tier.
              </p>
              <div className="rounded-lg border bg-muted/40 p-4 flex items-center justify-between">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Current price</p>
                  <p className="text-lg font-semibold line-through text-muted-foreground">£{priceBreakPrompt.oldPrice.toFixed(2)}</p>
                </div>
                <div className="text-muted-foreground text-xl">→</div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Special price</p>
                  <p className="text-2xl font-bold text-green-600">£{priceBreakPrompt.newPrice.toFixed(2)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Saves £{(priceBreakPrompt.oldPrice - priceBreakPrompt.newPrice).toFixed(2)} per item across {priceBreakPrompt.lineCount} {priceBreakPrompt.lineCount === 1 ? "line" : "lines"}
                {" "}(£{((priceBreakPrompt.oldPrice - priceBreakPrompt.newPrice) * priceBreakPrompt.totalQty).toFixed(2)} total saving)
              </p>
            </div>
          )}
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPriceBreakPrompt(null)} className="flex-1">
              Keep current price
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={applyPriceBreakMutation.isPending}
              onClick={() => priceBreakPrompt && applyPriceBreakMutation.mutate({
                productId: priceBreakPrompt.productId,
                unitPrice: priceBreakPrompt.newPrice,
              })}
            >
              {applyPriceBreakMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Updating…</>
                : `Apply £${priceBreakPrompt?.newPrice.toFixed(2)} to all ${priceBreakPrompt?.lineCount} ${priceBreakPrompt?.lineCount === 1 ? "line" : "lines"}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {priceConfirmDialog}
    </Layout>
  );
}
