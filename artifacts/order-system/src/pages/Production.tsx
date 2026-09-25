import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ClipboardList, CheckCircle2, Clock, Printer, ArrowRight,
  RefreshCw, Trash2, ChevronDown, ChevronRight, Sparkles, User, Archive, Ruler, Palette,
  ShoppingCart, ExternalLink, ListChecks, CheckSquare, Square, RotateCcw, AlertCircle,
  Search, Calendar, X, FileText, Zap, AlertTriangle, Play, Layers, TrendingUp, Pencil, Box,
  Mail, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate, formatCurrency } from "@/lib/utils";
import { sortSizes } from "@/lib/sizeUtils";
import { printWorksheetFromData as printWorksheetFromDataShared, printWorksheetsFromData } from "@/utils/printWorksheet";

const API_BASE = "/api";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProcessStep {
  id: number;
  name: string;
  type: string | null;
  placement: string | null;
  price: number | null;
  notes: string | null;
}

interface WorksheetItem {
  id: number;
  worksheetId: number;
  orderItemId: number | null;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  finishId: number | null;
  finishName: string | null;
  processes: ProcessStep[];
  notes: string | null;
  supplierCode: string | null;
  productSku: string | null;
}

interface Worksheet {
  id: number;
  worksheetNumber: string;
  status: "pre_wip" | "wip" | "complete";
  orderId: number | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string | null;
  requiredDate: string | null;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: WorksheetItem[];
  orderStatus: string | null;
  dispatchedAt: string | null;
  invoiceEmailSentAt: string | null;
  xeroInvoiceId: string | null;
}

interface PendingItem {
  id: number;
  productName: string;
  colour: string | null;
  size: string | null;
  purchaseQuantity: number;
  supplierName: string | null;
  supplierCode: string | null;
  productSku: string | null;
  poNumber: string | null;
  poStatus: string | null;
  estimatedDelivery: string | null;
}

interface PendingOrder {
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  items: PendingItem[];
}

interface ReadyItemSummary {
  id: number;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  finishName: string | null;
  finishId: number | null;
}

interface AllReadyOrder {
  id: number;
  orderNumber: string;
  customerId: number | null;
  customerName: string | null;
  requiredDate: string | null;
  totalAmount: number;
  items: ReadyItemSummary[];
}

interface PartInStockOrder {
  id: number;
  orderNumber: string;
  customerId: number | null;
  customerName: string | null;
  requiredDate: string | null;
  totalAmount: number;
  readyItems: ReadyItemSummary[];
  pendingItems: PendingItem[];
}

interface PickingItem {
  itemId: number;
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  productName: string;
  productId: number | null;
  productSku: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  finishId: number | null;
  finishName: string | null;
  stockStatus: string;
  stockAllocatedAt: string | null;
  binLocation: string | null;
}

interface PickingOrder {
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  items: PickingItem[];
}

const STATUS_CONFIG = {
  pre_wip: { label: "Pre-Production", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Clock },
  wip: { label: "Work in Progress", color: "bg-amber-100 text-amber-800 border-amber-200", icon: ClipboardList },
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
};

const PROCESS_COLOURS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  dtf:        { bg: "bg-cyan-100",   text: "text-cyan-700",   border: "border-cyan-200",   label: "DTF" },
  embroidery: { bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200", label: "Embroidery" },
  print:      { bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200",   label: "Print" },
  screen:     { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200", label: "Screen" },
  vinyl:      { bg: "bg-pink-100",   text: "text-pink-700",   border: "border-pink-200",   label: "Vinyl" },
};

function computeProcessQty(worksheets: Worksheet[]): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const ws of worksheets) {
    for (const item of ws.items) {
      total += item.quantity;
      for (const proc of item.processes) {
        const t = (proc.type ?? "").toLowerCase().trim();
        if (t) byType[t] = (byType[t] ?? 0) + item.quantity;
      }
    }
  }
  return { total, byType };
}

// ─── Filter types & utilities ──────────────────────────────────────────────────

interface Filters {
  search: string;
  finish: string;
  process: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { search: "", finish: "", process: "", dateFrom: "", dateTo: "" };

// ── Daily Work Plan types ──────────────────────────────────────────────────────
interface PlanTaskItem {
  productName: string;
  colour: string | null;
  size: string | null;
  qty: number;
  recipient: string | null;
}

interface PlanTask {
  type: "picking" | "pre_wip" | "wip";
  worksheetId: number | null;
  worksheetNumber: string | null;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
  qty: number;
  items: PlanTaskItem[];
}

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
  tasks: PlanTask[];
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

function matchesDateFilters(requiredDate: string | null | undefined, dateFrom: string, dateTo: string): boolean {
  if (dateFrom && requiredDate) {
    if (new Date(requiredDate) < new Date(dateFrom)) return false;
  }
  if (dateTo && requiredDate) {
    if (new Date(requiredDate) > new Date(dateTo + "T23:59:59")) return false;
  }
  return true;
}

function WsSortBar({ sort, onChange }: { sort: "number_asc" | "created_desc" | "due_date"; onChange: (s: "number_asc" | "created_desc" | "due_date") => void }) {
  const opts: { key: "number_asc" | "created_desc" | "due_date"; label: string }[] = [
    { key: "number_asc", label: "Worksheet #" },
    { key: "created_desc", label: "Date Produced" },
    { key: "due_date", label: "Due Date" },
  ];
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">Sort:</span>
      <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5 gap-0.5">
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${sort === o.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function sortWorksheets(worksheets: Worksheet[], sort: "number_asc" | "created_desc" | "due_date"): Worksheet[] {
  return [...worksheets].sort((a, b) => {
    if (sort === "number_asc") {
      const na = parseInt(a.worksheetNumber.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.worksheetNumber.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    }
    if (sort === "created_desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sort === "due_date") {
      if (!a.requiredDate && !b.requiredDate) return 0;
      if (!a.requiredDate) return 1;
      if (!b.requiredDate) return -1;
      return new Date(a.requiredDate).getTime() - new Date(b.requiredDate).getTime();
    }
    return 0;
  });
}

function filterWorksheets(worksheets: Worksheet[], f: Filters): Worksheet[] {
  return worksheets.filter((ws) => {
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!ws.customerName?.toLowerCase().includes(q) && !ws.orderNumber?.toLowerCase().includes(q) && !ws.worksheetNumber?.toLowerCase().includes(q)) return false;
    }
    if (f.finish) {
      const fin = f.finish.toLowerCase();
      if (!ws.items.some((i) => i.finishName?.toLowerCase().includes(fin))) return false;
    }
    if (f.process) {
      const proc = f.process.toLowerCase();
      if (!ws.items.some((i) => i.processes.some((p) =>
        p.name.toLowerCase().includes(proc) || (p.type ?? "").toLowerCase().includes(proc)
      ))) return false;
    }
    if (!matchesDateFilters(ws.requiredDate, f.dateFrom, f.dateTo)) return false;
    return true;
  });
}

function filterPickingOrders(orders: PickingOrder[], f: Filters): PickingOrder[] {
  return orders
    .map((order) => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!order.customerName?.toLowerCase().includes(q) && !order.orderNumber.toLowerCase().includes(q) && !order.worksheets?.some((ws: any) => ws.worksheetNumber?.toLowerCase().includes(q))) return null;
      }
      if (!matchesDateFilters(order.requiredDate, f.dateFrom, f.dateTo)) return null;
      let items = order.items;
      if (f.finish) {
        const fin = f.finish.toLowerCase();
        items = items.filter((i) => i.finishName?.toLowerCase().includes(fin));
        if (items.length === 0) return null;
      }
      return { ...order, items };
    })
    .filter(Boolean) as PickingOrder[];
}

// ── Send-to-Production matrix helpers ─────────────────────────────────────────
const SEND_SIZE_ORDER = [
  "one size","os","xs","extra small","s","small","m","medium","l","large",
  "xl","extra large","2xl","xxl","3xl","xxxl","4xl","5xl",
];
function sortSendSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = SEND_SIZE_ORDER.indexOf(a.toLowerCase());
    const bi = SEND_SIZE_ORDER.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}
interface SendMatrixCell { itemId: number; qty: number }
interface SendMatrixGroup {
  key: string;
  productName: string;
  finishName: string | null;
  colours: string[];
  sizes: string[];
  cells: Map<string, SendMatrixCell>; // "colour|size"
}
function buildSendMatrix(items: { id: number; productName: string; colour?: string | null; size?: string | null; finishName?: string | null; finishId?: number | null; quantity: number }[]): SendMatrixGroup[] {
  const groups = new Map<string, SendMatrixGroup>();
  for (const item of items) {
    const key = `${item.productName}|||${item.finishId ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, { key, productName: item.productName, finishName: item.finishName ?? null, colours: [], sizes: [], cells: new Map() });
    }
    const g = groups.get(key)!;
    const c = item.colour ?? "—";
    const s = item.size ?? "—";
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    g.cells.set(`${c}|${s}`, { itemId: item.id, qty: item.quantity });
  }
  for (const g of groups.values()) g.sizes = sortSendSizes(g.sizes);
  return [...groups.values()];
}

function FiltersBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = (key: keyof Filters, val: string) => onChange({ ...filters, [key]: val });
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 bg-muted/30 rounded-lg border border-border text-sm">
      <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Customer or order number…"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Finish…"
          value={filters.finish}
          onChange={(e) => set("finish", e.target.value)}
          className="bg-transparent outline-none placeholder:text-muted-foreground w-24 text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Process…"
          value={filters.process}
          onChange={(e) => set("process", e.target.value)}
          className="bg-transparent outline-none placeholder:text-muted-foreground w-24 text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => set("dateFrom", e.target.value)}
          className="bg-transparent outline-none text-muted-foreground w-32 text-sm"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set("dateTo", e.target.value)}
          className="bg-transparent outline-none text-muted-foreground w-32 text-sm"
        />
      </div>
      {hasFilters && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

// ─── Combined picking slip (multi-order matrix) ────────────────────────────────

function printCombinedPickingSlip(selectedItems: PickingItem[], allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB");

  // Count distinct orders
  const orderIds = new Set(selectedItems.map(i => i.orderId));
  const totalQty = selectedItems.reduce((s, i) => s + i.quantity, 0);

  // Build order summary list (date + customer)
  const orderSummaries = Array.from(orderIds).map(id => {
    const order = allOrders.find(o => o.orderId === id);
    if (!order) return "";
    const dueStr = order.requiredDate
      ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;
    return `${order.orderNumber}${order.customerName ? ` — ${order.customerName}` : ""}${dueStr ? ` (due ${dueStr})` : ""}`;
  }).filter(Boolean);

  // Group items by finish, build a matrix section per finish
  const finishGroupsMap = new Map<string, typeof selectedItems>();
  for (const item of selectedItems) {
    const fk = item.finishName ?? "Plain (No Finish)";
    if (!finishGroupsMap.has(fk)) finishGroupsMap.set(fk, []);
    finishGroupsMap.get(fk)!.push(item);
  }
  const sortedFinishKeys = Array.from(finishGroupsMap.keys()).sort((a, b) => {
    if (a === "Plain (No Finish)") return 1;
    if (b === "Plain (No Finish)") return -1;
    return a.localeCompare(b);
  });

  const thStyle = `background:#374151;color:white;padding:5px 8px;font-size:10px;text-align:center;white-space:nowrap`;
  const thLeftStyle = `background:#374151;color:white;padding:5px 8px;font-size:10px;text-align:left`;
  const tdStyle = `padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px`;
  const tdLeftStyle = `padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px`;

  const finishSections = sortedFinishKeys.map(finishName => {
    const fItems = finishGroupsMap.get(finishName)!;
    const matMap = new Map<string, { meta: { productName: string; productSku: string | null; supplierCode: string | null; supplierName: string | null; colour: string | null }; sizes: Map<string, number> }>();
    const matSizes = new Set<string>();
    for (const item of fItems) {
      const key = [item.supplierCode ?? "", item.productSku ?? "", item.productName, item.colour ?? ""].join("||");
      if (!matMap.has(key)) {
        matMap.set(key, { meta: { productName: item.productName, productSku: item.productSku, supplierCode: item.supplierCode, supplierName: item.supplierName, colour: item.colour }, sizes: new Map() });
      }
      const sk = item.size ?? "—";
      matSizes.add(sk);
      matMap.get(key)!.sizes.set(sk, (matMap.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
    }
    const sortedMatSizes = sortSizes(Array.from(matSizes));
    const matRows = Array.from(matMap.values());
    const finishTotal = fItems.reduce((s, i) => s + i.quantity, 0);
    const sizeHeaders = sortedMatSizes.map(s => `<th style="${thStyle}">${s}</th>`).join("");
    const tableRows = matRows.map(({ meta, sizes }, i) => {
      const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
      const sizeCells = sortedMatSizes.map(s => {
        const qty = sizes.get(s) ?? 0;
        return `<td style="${tdStyle}${qty > 0 ? ";font-weight:bold" : ";color:#bbb"}">${qty > 0 ? qty : "—"}</td>`;
      }).join("");
      return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
        <td style="${tdLeftStyle}">
          ${meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:11px">${meta.supplierCode}</span> ` : ""}
          ${meta.productSku ? `<span style="font-size:10px;color:#2563eb">${meta.productSku}</span><br>` : ""}
          ${meta.supplierName ? `<span style="font-size:10px;color:#888">${meta.supplierName}</span><br>` : ""}
          <span style="font-size:11px">${meta.productName}</span>
        </td>
        <td style="${tdLeftStyle}">${meta.colour ?? "—"}</td>
        ${sizeCells}
        <td style="${tdStyle};font-weight:bold;background:#f0f4ff">${rowTotal}</td>
        <td style="${tdStyle}"><span style="display:inline-block;width:22px;height:22px;border:1.5px solid #999;border-radius:3px">&nbsp;</span></td>
      </tr>`;
    }).join("");
    return `
      <div style="margin-bottom:6mm">
        <div style="display:inline-block;margin-bottom:2mm;padding:2px 10px;background:#1e3a5f;color:white;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.5px">${finishName}</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thLeftStyle}">Product / Style</th>
            <th style="${thLeftStyle}">Colour</th>
            ${sizeHeaders}
            <th style="${thStyle};background:#1e3a5f">Total</th>
            <th style="${thStyle}">Picked ✓</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div style="text-align:right;font-size:9px;color:#888;margin-top:1.5mm">${matRows.length} style${matRows.length !== 1 ? "s" : ""} · ${finishTotal} unit${finishTotal !== 1 ? "s" : ""}</div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Combined Picking Slip</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
      #page{display:flex;justify-content:center;padding:24px 0 40px}
      #sheet{background:white;padding:12mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:210mm}
      @media print{#toolbar{display:none}body{background:white}#page{padding:0}#sheet{box-shadow:none;padding:0}@page{size:A4 portrait;margin:12mm}}
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Combined Picking Slip — ${orderIds.size} order${orderIds.size !== 1 ? "s" : ""} · ${sortedFinishKeys.length} finish${sortedFinishKeys.length !== 1 ? "es" : ""} · Qty ${totalQty}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page"><div id="sheet">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:4mm;margin-bottom:4mm">
        <div>
          <div style="font-size:20px;font-weight:900;color:#1e3a5f">COMBINED PICKING SLIP</div>
          <div style="font-size:11px;color:#555;margin-top:1mm">${orderIds.size} order${orderIds.size !== 1 ? "s" : ""} · ${sortedFinishKeys.length} finish${sortedFinishKeys.length !== 1 ? "es" : ""} · Total qty ${totalQty}</div>
        </div>
        <div style="text-align:right"><div style="font-weight:bold">Your business</div><div style="color:#555">Printed: ${dateStr}</div></div>
      </div>
      <div style="font-size:10px;color:#555;margin-bottom:4mm;line-height:1.6">
        ${orderSummaries.map(s => `<span style="margin-right:16px">📦 ${s}</span>`).join("")}
      </div>
      ${finishSections}
      <div style="margin-top:8mm;display:flex;gap:30px;border-top:1px solid #e5e7eb;padding-top:4mm">
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Picked by: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Date picked: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Checked by: ___________________________</div>
      </div>
    </div></div>
  </body></html>`;

  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Print Per-Customer Picking Slips ─────────────────────────────────────────

function printPerCustomerPickingSlips(selectedItems: PickingItem[], allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB");

  const thStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:center;white-space:nowrap`;
  const thLeftStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:left`;
  const tdStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:10px`;
  const tdLeftStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;font-size:10px`;

  // ── Group items by customer name (same customer = one slip, regardless of order count) ──
  type CustomerGroup = {
    customerName: string | null;
    orders: Array<{ orderNumber: string; requiredDate: string | null; orderId: number }>;
    items: PickingItem[];
    earliestDate: string | null;
  };
  const groupMap = new Map<string, CustomerGroup>();

  for (const item of selectedItems) {
    const order = allOrders.find(o => o.orderId === item.orderId);
    // Key by customer name; fall back to orderId string so un-named orders don't collapse
    const groupKey = item.customerName ? item.customerName.toLowerCase().trim() : `__order_${item.orderId}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { customerName: item.customerName, orders: [], items: [], earliestDate: null });
    }
    const group = groupMap.get(groupKey)!;
    group.items.push(item);
    if (order && !group.orders.find(o => o.orderId === order.orderId)) {
      group.orders.push({ orderNumber: order.orderNumber, requiredDate: order.requiredDate, orderId: order.orderId });
    }
  }

  // Compute earliest required date per group and sort orders within each group by date
  for (const group of groupMap.values()) {
    group.orders.sort((a, b) => {
      if (!a.requiredDate && !b.requiredDate) return 0;
      if (!a.requiredDate) return 1;
      if (!b.requiredDate) return -1;
      return a.requiredDate.localeCompare(b.requiredDate);
    });
    const dates = group.orders.map(o => o.requiredDate).filter(Boolean) as string[];
    group.earliestDate = dates.length > 0 ? dates[0] : null;
  }

  // Sort customer groups: most urgent (earliest required date) first, undated last
  const sortedGroups = Array.from(groupMap.values()).sort((a, b) => {
    if (!a.earliestDate && !b.earliestDate) return 0;
    if (!a.earliestDate) return 1;
    if (!b.earliestDate) return -1;
    return a.earliestDate.localeCompare(b.earliestDate);
  });

  const slipPages = sortedGroups.map((group, pageIdx) => {
    const totalQty = group.items.reduce((s, i) => s + i.quantity, 0);

    // Build finish-grouped matrix sections for this customer slip
    const custFinishMap = new Map<string, typeof group.items>();
    for (const item of group.items) {
      const fk = item.finishName ?? "Plain (No Finish)";
      if (!custFinishMap.has(fk)) custFinishMap.set(fk, []);
      custFinishMap.get(fk)!.push(item);
    }
    const custFinishKeys = Array.from(custFinishMap.keys()).sort((a, b) => {
      if (a === "Plain (No Finish)") return 1;
      if (b === "Plain (No Finish)") return -1;
      return a.localeCompare(b);
    });
    const custFinishSections = custFinishKeys.map(finishName => {
      const fItems = custFinishMap.get(finishName)!;
      const matMap2 = new Map<string, { meta: { productName: string; productSku: string | null; supplierCode: string | null; supplierName: string | null; colour: string | null }; sizes: Map<string, number> }>();
      const matSizes2 = new Set<string>();
      for (const item of fItems) {
        const key = [item.supplierCode ?? "", item.productSku ?? "", item.productName, item.colour ?? ""].join("||");
        if (!matMap2.has(key)) {
          matMap2.set(key, { meta: { productName: item.productName, productSku: item.productSku, supplierCode: item.supplierCode, supplierName: item.supplierName, colour: item.colour }, sizes: new Map() });
        }
        const sk = item.size ?? "—";
        matSizes2.add(sk);
        matMap2.get(key)!.sizes.set(sk, (matMap2.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
      }
      const sortedMatSizes2 = sortSizes(Array.from(matSizes2));
      const matRows2 = Array.from(matMap2.values());
      const finishTotal2 = fItems.reduce((s, i) => s + i.quantity, 0);
      const sizeHeaders2 = sortedMatSizes2.map(s => `<th style="${thStyle}">${s}</th>`).join("");
      const tableRows2 = matRows2.map(({ meta, sizes }, i) => {
        const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
        const sizeCells = sortedMatSizes2.map(s => {
          const qty = sizes.get(s) ?? 0;
          return `<td style="${tdStyle}${qty > 0 ? ";font-weight:bold" : ";color:#bbb"}">${qty > 0 ? qty : "—"}</td>`;
        }).join("");
        return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
          <td style="${tdLeftStyle}">
            ${meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:10px">${meta.supplierCode}</span> ` : ""}
            ${meta.productSku ? `<span style="font-size:9px;color:#2563eb">${meta.productSku}</span><br>` : ""}
            ${meta.supplierName ? `<span style="font-size:9px;color:#888">${meta.supplierName}</span><br>` : ""}
            <span style="font-size:10px">${meta.productName}</span>
          </td>
          <td style="${tdLeftStyle}">${meta.colour ?? "—"}</td>
          ${sizeCells}
          <td style="${tdStyle};font-weight:bold;background:#f0f4ff">${rowTotal}</td>
          <td style="${tdStyle}"><span style="display:inline-block;width:20px;height:20px;border:1.5px solid #999;border-radius:3px">&nbsp;</span></td>
        </tr>`;
      }).join("");
      return `
        <div style="margin-bottom:5mm">
          <div style="display:inline-block;margin-bottom:1.5mm;padding:2px 9px;background:#1e3a5f;color:white;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:0.4px">${finishName}</div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr>
              <th style="${thLeftStyle}">Product / Style</th>
              <th style="${thLeftStyle}">Colour</th>
              ${sizeHeaders2}
              <th style="${thStyle};background:#1e3a5f">Total</th>
              <th style="${thStyle}">Picked ✓</th>
            </tr></thead>
            <tbody>${tableRows2}</tbody>
          </table>
          <div style="text-align:right;font-size:9px;color:#888;margin-top:1mm">${matRows2.length} style${matRows2.length !== 1 ? "s" : ""} · ${finishTotal2} unit${finishTotal2 !== 1 ? "s" : ""}</div>
        </div>`;
    }).join("");

    // Order list — sorted by required date, each on its own line
    const orderLines = group.orders.map(o => {
      const due = o.requiredDate
        ? new Date(o.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : null;
      const isEarliest = o.requiredDate === group.earliestDate;
      return `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:18px${isEarliest && group.orders.length > 1 ? ";font-weight:bold" : ""}">
        <span style="font-family:monospace;font-size:10px;color:#1e3a5f">${o.orderNumber}</span>
        ${due ? `<span style="font-size:10px;color:${isEarliest ? "#b45309" : "#555"}">${isEarliest && group.orders.length > 1 ? "⚑ " : ""}Due: ${due}</span>` : ""}
      </span>`;
    }).join("");

    const isLast = pageIdx === sortedGroups.length - 1;
    return `
      <div class="slip${isLast ? "" : " page-break"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:3mm;margin-bottom:3mm">
          <div>
            <div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1.1">${group.customerName ?? "Unknown Customer"}</div>
            <div style="font-size:11px;font-weight:700;color:#374151;letter-spacing:0.5px;margin-top:1.5mm">PICKING SLIP</div>
            <div style="font-size:10px;color:#555;margin-top:2mm;line-height:1.8">${orderLines}</div>
            <div style="font-size:10px;color:#666;margin-top:1mm">${custFinishKeys.length} finish${custFinishKeys.length !== 1 ? "es" : ""} &nbsp;·&nbsp; Total qty <strong>${totalQty}</strong></div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8mm">
            <div style="font-weight:bold;font-size:12px">Your business</div>
            <div style="color:#555;font-size:10px">Printed: ${dateStr}</div>
            ${group.earliestDate ? `<div style="margin-top:2mm;font-size:11px;font-weight:bold;color:#b45309">Required by: ${new Date(group.earliestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>` : ""}
          </div>
        </div>
        ${custFinishSections}
        <div style="margin-top:6mm;display:flex;gap:24px;border-top:1px solid #e5e7eb;padding-top:3mm">
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Picked by: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Date picked: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Checked by: ___________________________</div>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Per-Customer Picking Slips</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:10px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
      #page{display:flex;flex-direction:column;align-items:center;padding:24px 0 40px;gap:24px}
      .slip{background:white;padding:10mm 12mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:257mm}
      @media print{
        #toolbar{display:none}body{background:white}#page{padding:0;gap:0}
        .slip{box-shadow:none;width:100%;padding:0}
        .page-break{page-break-after:always}
        @page{size:A4 portrait;margin:10mm}
      }
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Per-Customer Picking Slips — ${sortedGroups.length} customer${sortedGroups.length !== 1 ? "s" : ""} · sorted by required date</span>
      <button id="btn-print" onclick="window.print()">🖨 Print all ${sortedGroups.length}</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page">${slipPages}</div>
  </body></html>`;

  const win2 = window.open("", "_blank", "width=1100,height=800");
  if (!win2) return;
  win2.document.write(html);
  win2.document.close();
  win2.focus();
}

function PrintWorksheet({ ws }: { ws: Worksheet }) {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Group items by finish
  const finishMap = new Map<string, WorksheetItem[]>();
  for (const item of ws.items) {
    const fk = item.finishName ?? "Plain (No Finish)";
    if (!finishMap.has(fk)) finishMap.set(fk, []);
    finishMap.get(fk)!.push(item);
  }
  const sortedFinishes = Array.from(finishMap.keys()).sort((a, b) => {
    if (a === "Plain (No Finish)") return 1;
    if (b === "Plain (No Finish)") return -1;
    return a.localeCompare(b);
  });
  const printTotalQty = ws.items.reduce((s, i) => s + (i.quantity ?? 1), 0);

  return (
    <div className="print-only bg-white text-black font-sans text-sm" style={{ width: "210mm", padding: "12mm 15mm", boxSizing: "border-box" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "5mm", borderBottom: "2px solid #1e3a5f", paddingBottom: "4mm" }}>
        <div>
          {ws.customerName && <div style={{ fontSize: "26px", fontWeight: "900", color: "#1e3a5f", marginBottom: "1mm" }}>{ws.customerName}</div>}
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#1e3a5f", letterSpacing: "1px" }}>PRODUCTION WORKSHEET</div>
          <div style={{ fontSize: "12px", color: "#555", marginTop: "1mm" }}>{ws.worksheetNumber} · Order {ws.orderNumber ?? "—"}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "11px", color: "#555" }}>
          <div style={{ fontWeight: "bold", fontSize: "13px" }}>Your business</div>
          <div>Printed: {dateStr}</div>
          <div style={{ marginTop: "1mm" }}>{printTotalQty} item{printTotalQty !== 1 ? "s" : ""} · {sortedFinishes.length} finish{sortedFinishes.length !== 1 ? "es" : ""}</div>
        </div>
      </div>

      {/* One section per finish */}
      {sortedFinishes.map((finishName) => {
        const fItems = finishMap.get(finishName)!;
        // Representative processes from the first item that has any
        const repProcesses = fItems.find(i => i.processes.length > 0)?.processes ?? [];

        // Build matrix: rows = product+colour, columns = sizes
        const matMap = new Map<string, { productName: string; productSku: string | null; colour: string | null; supplierCode: string | null; sizes: Map<string, number> }>();
        const allSizes = new Set<string>();
        for (const item of fItems) {
          const key = `${item.productName}||${item.colour ?? ""}`;
          if (!matMap.has(key)) matMap.set(key, { productName: item.productName, productSku: item.productSku ?? null, colour: item.colour, supplierCode: item.supplierCode ?? null, sizes: new Map() });
          const sk = item.size ?? "—";
          allSizes.add(sk);
          matMap.get(key)!.sizes.set(sk, (matMap.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
        }
        const sortedSizes = sortSizes(Array.from(allSizes));
        const matRows = Array.from(matMap.values());
        const finishTotal = fItems.reduce((s, i) => s + i.quantity, 0);

        return (
          <div key={finishName} style={{ marginBottom: "6mm", pageBreakInside: "avoid", border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}>
            {/* Finish header */}
            <div style={{ backgroundColor: "#e8edf5", color: "#1e3a5f", borderLeft: "5px solid #1e3a5f", padding: "5px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: "800", fontSize: "13px" }}>{finishName}</span>
              <span style={{ fontSize: "11px", color: "#374151" }}>{matRows.length} style{matRows.length !== 1 ? "s" : ""} · {finishTotal} unit{finishTotal !== 1 ? "s" : ""}</span>
            </div>

            {/* Decoration processes */}
            {repProcesses.length > 0 && (
              <div style={{ padding: "5px 10px", backgroundColor: "#f0f4ff", borderBottom: "1px solid #dbeafe" }}>
                <div style={{ fontSize: "9px", fontWeight: "700", color: "#1e40af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>
                  Decoration Processes
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#dbeafe" }}>
                      <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Process</th>
                      <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Type</th>
                      <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Placement</th>
                      <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Notes</th>
                      <th style={{ padding: "2px 6px", textAlign: "center", fontWeight: "600" }}>Done ✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repProcesses.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "3px 6px", fontWeight: "600" }}>{p.name}</td>
                        <td style={{ padding: "3px 6px", color: "#555" }}>{p.type ?? "—"}</td>
                        <td style={{ padding: "3px 6px", color: "#555" }}>{p.placement ?? "—"}</td>
                        <td style={{ padding: "3px 6px", color: "#777", fontStyle: "italic" }}>{p.notes ?? "—"}</td>
                        <td style={{ padding: "3px 6px", textAlign: "center" }}>
                          <span style={{ display: "inline-block", width: "18px", height: "18px", border: "1.5px solid #999", borderRadius: "3px" }}></span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Matrix: product+colour rows × size columns */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ backgroundColor: "#374151", color: "white" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontSize: "10px" }}>Product</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontSize: "10px", whiteSpace: "nowrap" }}>SKU</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontSize: "10px" }}>Colour</th>
                  {sortedSizes.map(s => (
                    <th key={s} style={{ padding: "4px 8px", textAlign: "center", fontSize: "10px", whiteSpace: "nowrap" }}>{s}</th>
                  ))}
                  <th style={{ padding: "4px 8px", textAlign: "center", fontSize: "10px", backgroundColor: "#1e3a5f" }}>Total</th>
                  <th style={{ padding: "4px 8px", textAlign: "center", fontSize: "10px" }}>Done ✓</th>
                </tr>
              </thead>
              <tbody>
                {matRows.map(({ productName, productSku, colour, sizes }, i) => {
                  const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
                  return (
                    <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#f9fafb" : "white", borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "4px 8px", fontWeight: "600" }}>{productName}</td>
                      <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: "10px", color: "#1e3a5f", fontWeight: "600", whiteSpace: "nowrap" }}>{productSku ?? "—"}</td>
                      <td style={{ padding: "4px 8px", color: "#555" }}>{colour ?? "—"}</td>
                      {sortedSizes.map(s => {
                        const qty = sizes.get(s) ?? 0;
                        return (
                          <td key={s} style={{ padding: "4px 8px", textAlign: "center", fontWeight: qty > 0 ? "bold" : "normal", color: qty > 0 ? "#111" : "#ccc" }}>
                            {qty > 0 ? qty : "—"}
                          </td>
                        );
                      })}
                      <td style={{ padding: "4px 8px", textAlign: "center", fontWeight: "bold", backgroundColor: "#f0f4ff" }}>{rowTotal}</td>
                      <td style={{ padding: "4px 8px", textAlign: "center" }}>
                        <span style={{ display: "inline-block", width: "20px", height: "20px", border: "1.5px solid #999", borderRadius: "3px" }}></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {ws.notes && (
        <div style={{ marginTop: "3mm", padding: "3mm", backgroundColor: "#fff9c4", border: "1px solid #f59e0b", borderRadius: "4px", fontSize: "11px" }}>
          <strong>Notes:</strong> {ws.notes}
        </div>
      )}

      {/* Sign-off */}
      <div style={{ marginTop: "6mm", display: "flex", gap: "20px" }}>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Produced by: ___________________________</div>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Date completed: ___________________________</div>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Checked by: ___________________________</div>
      </div>

      <div style={{ marginTop: "6mm", paddingTop: "3mm", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#aaa" }}>
        <span>Your business — Internal Use Only</span>
        <span>{ws.worksheetNumber} · {dateStr}</span>
      </div>
    </div>
  );
}

function WorksheetCardMatrix({ ws, editMode = false, qtyEdits, onQtyChange }: {
  ws: Worksheet;
  editMode?: boolean;
  qtyEdits?: Map<number, number>;
  onQtyChange?: (itemId: number, qty: number) => void;
}) {
  const finishMap = useMemo(() => {
    const map = new Map<string, WorksheetItem[]>();
    for (const item of ws.items) {
      const fk = item.finishName ?? "Plain (No Finish)";
      if (!map.has(fk)) map.set(fk, []);
      map.get(fk)!.push(item);
    }
    return map;
  }, [ws.items]);

  const sortedFinishes = useMemo(() =>
    Array.from(finishMap.keys()).sort((a, b) => {
      if (a === "Plain (No Finish)") return 1;
      if (b === "Plain (No Finish)") return -1;
      return a.localeCompare(b);
    }),
    [finishMap],
  );

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      {editMode && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Edit quantities to match what was physically picked. Set to 0 to remove a size from this worksheet.
        </div>
      )}
      {sortedFinishes.map((finishName) => {
        const fItems = finishMap.get(finishName)!;
        const repProcesses = fItems.find((i) => i.processes.length > 0)?.processes ?? [];

        const matMap = new Map<string, { productName: string; colour: string | null; sizes: Map<string, { qty: number; itemId: number }> }>();
        const allSizes = new Set<string>();
        for (const item of fItems) {
          const key = `${item.productName}||${item.colour ?? ""}`;
          if (!matMap.has(key)) matMap.set(key, { productName: item.productName, colour: item.colour, sizes: new Map() });
          const sk = item.size ?? "—";
          allSizes.add(sk);
          const existing = matMap.get(key)!.sizes.get(sk);
          matMap.get(key)!.sizes.set(sk, { qty: (existing?.qty ?? 0) + item.quantity, itemId: item.id });
        }
        const sortedSizes = sortSizes(Array.from(allSizes));
        const matRows = Array.from(matMap.values());
        const finishTotal = fItems.reduce((s, i) => {
          const edited = qtyEdits?.get(i.id);
          return s + (edited !== undefined ? edited : i.quantity);
        }, 0);
        const isPlain = finishName === "Plain (No Finish)";

        return (
          <div key={finishName} className="rounded-lg border border-border overflow-hidden">
            {/* Finish header */}
            <div className={`flex items-center justify-between px-3 py-2 ${isPlain ? "bg-muted/60" : "bg-[#1e3a5f] text-white"}`}>
              <span className={`text-xs font-semibold flex items-center gap-1.5 ${isPlain ? "text-muted-foreground" : "text-white"}`}>
                {!isPlain && <Sparkles className="w-3 h-3 text-amber-300" />}
                {finishName}
              </span>
              <span className={`text-xs ${isPlain ? "text-muted-foreground" : "text-white/70"}`}>
                {matRows.length} style{matRows.length !== 1 ? "s" : ""} · {finishTotal} unit{finishTotal !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Decoration processes */}
            {repProcesses.length > 0 && (
              <div className="bg-blue-50 border-b border-blue-100 px-3 py-2">
                <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1.5">Decoration Processes</p>
                <div className="space-y-1">
                  {repProcesses.map((p) => (
                    <div key={p.id} className="flex gap-3 text-xs pl-2 border-l-2 border-blue-300">
                      <span className="font-semibold text-foreground">{p.name}</span>
                      {p.type && <span className="text-muted-foreground">{p.type}</span>}
                      {p.placement && <span className="text-muted-foreground">{p.placement}</span>}
                      {p.notes && <span className="text-muted-foreground italic">{p.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Matrix table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Product</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Colour</th>
                    {sortedSizes.map((s) => (
                      <th key={s} className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{s}</th>
                    ))}
                    <th className="text-center px-3 py-2 font-semibold text-foreground bg-muted/60 whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matRows.map(({ productName, colour, sizes }, ri) => {
                    const rowTotal = sortedSizes.reduce((s, sk) => {
                      const cell = sizes.get(sk);
                      if (!cell) return s;
                      const editedQty = qtyEdits?.get(cell.itemId);
                      return s + (editedQty !== undefined ? editedQty : cell.qty);
                    }, 0);
                    return (
                      <tr key={ri} className={`border-b border-border last:border-0 ${ri % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                        <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{productName}</td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{colour ?? "—"}</td>
                        {sortedSizes.map((sk) => {
                          const cell = sizes.get(sk);
                          const originalQty = cell?.qty ?? 0;
                          const editedQty = cell ? (qtyEdits?.get(cell.itemId) ?? originalQty) : 0;
                          const displayQty = editMode ? editedQty : originalQty;
                          const changed = editMode && cell && (qtyEdits?.get(cell.itemId) !== undefined) && qtyEdits!.get(cell.itemId) !== originalQty;
                          return (
                            <td key={sk} className="text-center px-2 py-1.5">
                              {editMode && cell ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={editedQty}
                                  onChange={(e) => onQtyChange?.(cell.itemId, Math.max(0, parseInt(e.target.value) || 0))}
                                  className={`w-16 text-center text-xs font-bold rounded border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 ${changed ? "border-amber-400 bg-amber-50 text-amber-800" : "border-border bg-background"}`}
                                />
                              ) : (
                                <span className={`${displayQty > 0 ? "font-bold text-foreground" : "text-muted-foreground/30 select-none"}`}>
                                  {displayQty > 0 ? displayQty : "—"}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center px-3 py-2 font-bold text-foreground bg-muted/40">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {ws.notes && (
        <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{ws.notes}</div>
      )}
    </div>
  );
}

// ─── Standalone worksheet print (no DOM dependency, usable before card renders) ──
function printWorksheetFromData(ws: Worksheet) {
  printWorksheetFromDataShared(ws);
}


function WorksheetCard({ ws, onStatusChange, onDelete, onReturnToPicking }: {
  ws: Worksheet;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onReturnToPicking: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [qtyEdits, setQtyEdits] = useState<Map<number, number>>(new Map());
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const cfg = STATUS_CONFIG[ws.status];
  const StatusIcon = cfg.icon;
  const canEdit = ws.status === "pre_wip" || ws.status === "wip";
  const wsTotalQty = ws.items.reduce((s, i) => s + (i.quantity ?? 1), 0);

  const handlePrint = () => printWorksheetFromData(ws);

  function startEditing() {
    setQtyEdits(new Map());
    setEditing(true);
    setExpanded(true);
  }

  function cancelEditing() {
    setEditing(false);
    setQtyEdits(new Map());
  }

  async function saveEdits() {
    if (qtyEdits.size === 0) { setEditing(false); return; }
    setSaving(true);
    try {
      for (const [itemId, qty] of qtyEdits) {
        await apiFetch(`/worksheets/${ws.id}/items/${itemId}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity: qty }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      setEditing(false);
      setQtyEdits(new Map());
      toast({ title: "Quantities updated", description: `${qtyEdits.size} item${qtyEdits.size !== 1 ? "s" : ""} adjusted` });
    } catch {
      toast({ title: "Failed to save", description: "Could not update worksheet quantities", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => !editing && setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-base">{ws.worksheetNumber}</span>
              <Badge className={`text-xs ${cfg.color} gap-1`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
              {editing && <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300">Editing quantities</Badge>}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {ws.orderNumber && <span>Order {ws.orderNumber} · </span>}
              {ws.customerName && <span>{ws.customerName} · </span>}
              <span>{wsTotalQty} item{wsTotalQty !== 1 ? "s" : ""}</span>
              <span className="ml-2 text-xs">{formatDate(ws.createdAt)}</span>
            </div>
            {ws.requiredDate && (
              <div className="flex items-center gap-1 mt-1 text-xs font-medium text-rose-700">
                <Calendar className="w-3 h-3" />
                Due {formatDate(ws.requiredDate)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={saveEdits} disabled={saving || qtyEdits.size === 0}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {saving ? "Saving…" : `Save${qtyEdits.size > 0 ? ` (${qtyEdits.size})` : ""}`}
              </Button>
            </>
          ) : (
            <>
              {(ws.status === "pre_wip" || ws.status === "wip") && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => onReturnToPicking(ws.id)}>
                    <RotateCcw className="w-3.5 h-3.5" /> Return to Picking
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50" onClick={startEditing}>
                      <Pencil className="w-3.5 h-3.5" /> Edit Qtys
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
                    <Printer className="w-3.5 h-3.5" /> Print
                  </Button>
                  <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onStatusChange(ws.id, "complete")}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
                  </Button>
                </>
              )}
              {ws.status === "complete" && (() => {
                const isDispatched = !!(ws.dispatchedAt || ws.orderStatus === "shipped" || ws.orderStatus === "delivered");
                const isInvoiced = !!(ws.xeroInvoiceId || ws.invoiceEmailSentAt);
                const needsInvoice = isDispatched && !isInvoiced;
                return (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
                      <Printer className="w-3.5 h-3.5" /> Print
                    </Button>
                    {!isDispatched && (
                      <Button
                        size="sm"
                        className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => { window.location.href = "/order-system/dispatch?search=" + encodeURIComponent(ws.orderNumber ?? ""); }}
                      >
                        <ArrowRight className="w-3.5 h-3.5" /> Go to Dispatch
                      </Button>
                    )}
                    {needsInvoice && (
                      <Button
                        size="sm"
                        className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => { window.location.href = "/order-system/invoices"; }}
                      >
                        <Mail className="w-3.5 h-3.5" /> Send Invoice
                      </Button>
                    )}
                    {isInvoiced && (
                      <Badge className="gap-1 text-xs bg-indigo-100 text-indigo-800 border-indigo-300">
                        {ws.xeroInvoiceId ? <BookOpen className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                        {ws.xeroInvoiceId ? "In Xero" : "Invoice Sent"}
                      </Badge>
                    )}
                  </>
                );
              })()}
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => onDelete(ws.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <WorksheetCardMatrix
          ws={ws}
          editMode={editing}
          qtyEdits={qtyEdits}
          onQtyChange={(itemId, qty) => setQtyEdits((prev) => { const next = new Map(prev); next.set(itemId, qty); return next; })}
        />
      )}
    </div>
  );
}

function PendingOrderCard({ order }: { order: PendingOrder }) {
  const [expanded, setExpanded] = useState(true);

  const totalUnits = order.items.reduce((s, i) => s + i.purchaseQuantity, 0);
  const suppliers = [...new Set(order.items.map((i) => i.supplierName).filter(Boolean))];

  // Build colour × size matrices, grouped by product name
  const matrices = useMemo(() => {
    type Matrix = {
      productName: string;
      supplierName: string | null;
      supplierCode: string | null;
      productSku: string | null;
      colours: string[];
      sizes: string[];
      cells: Map<string, PendingItem>; // key: "colour||size"
    };
    const map = new Map<string, Matrix>();
    for (const item of order.items) {
      if (!map.has(item.productName)) {
        map.set(item.productName, { productName: item.productName, supplierName: item.supplierName, supplierCode: item.supplierCode, productSku: item.productSku, colours: [], sizes: [], cells: new Map() });
      }
      const m = map.get(item.productName)!;
      const colour = item.colour ?? "";
      const size = item.size ?? "";
      if (!m.colours.includes(colour)) m.colours.push(colour);
      if (!m.sizes.includes(size)) m.sizes.push(size);
      const ck1 = `${colour}||${size}`;
      const ex1 = m.cells.get(ck1);
      m.cells.set(ck1, ex1 ? { ...ex1, quantity: ex1.quantity + item.quantity } : item);
    }
    for (const m of map.values()) {
      m.sizes = sortSizes(m.sizes);
    }
    return [...map.values()];
  }, [order.items]);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-amber-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-amber-600 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-amber-600 flex-shrink-0" />}
          <ShoppingCart className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`/orders/${order.orderId}`}
                className="font-mono font-bold text-base hover:underline text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                {order.orderNumber}
              </a>
              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1">
                <ShoppingCart className="w-3 h-3" /> Awaiting Stock
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {order.customerName && <span>{order.customerName}</span>}
              {order.requiredDate && <span>· Due {formatDate(order.requiredDate)}</span>}
              <span>· {order.items.length} line{order.items.length !== 1 ? "s" : ""} · {totalUnits} unit{totalUnits !== 1 ? "s" : ""} to purchase</span>
              {suppliers.length > 0 && <span>· from {suppliers.join(", ")}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <a href={`/orders/${order.orderId}`}>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> View Order
            </Button>
          </a>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 px-5 py-4 space-y-4">
          {matrices.map((m) => {
            const hasSizes = m.sizes.some(s => s !== "");
            const hasColours = m.colours.some(c => c !== "");
            return (
              <div key={m.productName}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-semibold text-foreground">{m.productName}</span>
                    {m.supplierCode && (
                      <span className="font-mono text-xs font-bold text-primary">{m.supplierCode}</span>
                    )}
                    {m.productSku && (
                      <span className="text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">{m.productSku}</span>
                    )}
                  </div>
                  {m.supplierName && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">{m.supplierName}</span>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-amber-100">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-amber-50/80 border-b border-amber-100">
                        {hasColours && <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Colour</th>}
                        {hasSizes
                          ? m.sizes.map(size => (
                              <th key={size} className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{size || "—"}</th>
                            ))
                          : <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>
                        }
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Total</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.colours.map((colour, ci) => {
                        const rowItems = (hasSizes ? m.sizes : [""]).map(size => m.cells.get(`${colour}||${size}`));
                        const existing = rowItems.filter(Boolean) as PendingItem[];
                        const rowTotal = existing.reduce((s, it) => s + it.purchaseQuantity, 0);
                        const allOrdered = existing.length > 0 && existing.every(it => it.poStatus === "ordered");
                        const allDraft = existing.length > 0 && existing.every(it => it.poStatus === "draft");
                        const anyOnPo = existing.some(it => !!it.poNumber);
                        const delivery = existing.find(it => it.estimatedDelivery)?.estimatedDelivery;
                        return (
                          <tr key={colour} className={`border-b border-amber-50 last:border-0 ${ci % 2 === 0 ? "bg-white/60" : "bg-amber-50/20"}`}>
                            {hasColours && (
                              <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{colour || "—"}</td>
                            )}
                            {(hasSizes ? m.sizes : [""]).map(size => {
                              const item = m.cells.get(`${colour}||${size}`);
                              if (!item) return <td key={size} className="text-center px-3 py-2 text-muted-foreground/30 select-none">—</td>;
                              const cellCls = item.poStatus === "ordered"
                                ? "bg-green-100 text-green-800"
                                : item.poStatus === "draft"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-amber-100 text-amber-800";
                              return (
                                <td key={size} className="text-center px-2 py-1.5">
                                  <span className={`inline-block min-w-[1.75rem] rounded px-1.5 py-0.5 font-semibold ${cellCls}`}>
                                    {item.purchaseQuantity}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="text-center px-3 py-2 font-semibold text-foreground">{rowTotal}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                {allOrdered ? (
                                  <span className="inline-flex items-center gap-1 text-green-700">
                                    <CheckCircle2 className="w-3 h-3" /> Ordered
                                  </span>
                                ) : allDraft ? (
                                  <span className="inline-flex items-center gap-1 text-blue-700">
                                    <Clock className="w-3 h-3" /> Draft PO
                                  </span>
                                ) : anyOnPo ? (
                                  <span className="inline-flex items-center gap-1 text-amber-700">
                                    <AlertCircle className="w-3 h-3" /> Partial
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-amber-600">
                                    <AlertCircle className="w-3 h-3" /> Not yet ordered
                                  </span>
                                )}
                                {delivery && (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(delivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {(() => {
            const allItems = order.items;
            const anyOnPo = allItems.some(i => !!i.poNumber);
            const allOrdered = allItems.length > 0 && allItems.every(i => i.poStatus === "ordered");
            if (allOrdered) {
              return (
                <p className="text-xs text-green-700 flex items-center gap-1.5 pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  All lines are on order. When the supplier delivers and you book it in Purchasing, these items will automatically move to the Picking List.
                </p>
              );
            }
            if (anyOnPo) {
              return (
                <p className="text-xs text-amber-700 flex items-center gap-1.5 pt-1">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Book the delivery in Purchasing to automatically move items to the Picking List — or click <strong>Stock received</strong> above if the goods have already arrived.
                </p>
              );
            }
            return (
              <p className="text-xs text-amber-700 flex items-center gap-1.5 pt-1">
                <ShoppingCart className="w-3.5 h-3.5" />
                No purchase order has been raised for these items. If stock has arrived, click <strong>Stock received</strong> above — items will move straight to the Picking List.
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── ItemMatrix (reusable grid for ready items) ────────────────────────────────
function ItemMatrix({ items, borderClass = "border-gray-200", headClass = "bg-gray-50 border-gray-200" }: {
  items: ReadyItemSummary[];
  borderClass?: string;
  headClass?: string;
}) {
  const matrices = useMemo(() => {
    const map = new Map<string, { colours: string[]; sizes: string[]; cells: Map<string, ReadyItemSummary>; finishName: string | null }>();
    for (const item of items) {
      if (!map.has(item.productName)) map.set(item.productName, { colours: [], sizes: [], cells: new Map(), finishName: item.finishName });
      const m = map.get(item.productName)!;
      const colour = item.colour ?? "";
      const size = item.size ?? "";
      if (!m.colours.includes(colour)) m.colours.push(colour);
      if (!m.sizes.includes(size)) m.sizes.push(size);
      const ck2 = `${colour}||${size}`;
      const ex2 = m.cells.get(ck2);
      m.cells.set(ck2, ex2 ? { ...ex2, quantity: ex2.quantity + item.quantity } : item);
    }
    for (const m of map.values()) m.sizes = sortSizes(m.sizes);
    return [...map.entries()].map(([productName, m]) => ({ productName, ...m }));
  }, [items]);

  return (
    <div className="space-y-3">
      {matrices.map((m) => {
        const hasSizes = m.sizes.some(s => s !== "");
        const hasColours = m.colours.some(c => c !== "");
        return (
          <div key={m.productName}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-foreground">{m.productName}</span>
              {m.finishName && <span className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="w-3 h-3" />{m.finishName}</span>}
            </div>
            <div className={`overflow-x-auto rounded-lg border ${borderClass}`}>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className={`${headClass} border-b`}>
                    {hasColours && <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Colour</th>}
                    {hasSizes
                      ? m.sizes.map(s => <th key={s} className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{s || "—"}</th>)
                      : <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>}
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {m.colours.map((colour, ci) => {
                    const rowTotal = (hasSizes ? m.sizes : [""]).reduce((sum, s) => sum + (m.cells.get(`${colour}||${s}`)?.quantity ?? 0), 0);
                    return (
                      <tr key={colour} className={`border-b last:border-0 ${ci % 2 === 0 ? "bg-white/60" : "bg-muted/10"}`}>
                        {hasColours && <td className="px-3 py-2 font-medium whitespace-nowrap">{colour || "—"}</td>}
                        {hasSizes
                          ? m.sizes.map(s => {
                              const item = m.cells.get(`${colour}||${s}`);
                              return <td key={s} className="text-center px-2 py-1.5">{item ? <span className="font-semibold">{item.quantity}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                            })
                          : <td className="text-center px-2 py-1.5 font-semibold">{rowTotal}</td>}
                        <td className="text-center px-2 py-1.5 font-semibold text-foreground">{rowTotal}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t bg-muted/20 font-semibold text-xs">
                    {hasColours && <td className="px-3 py-1.5 text-muted-foreground uppercase tracking-wide">Total</td>}
                    {hasSizes
                      ? m.sizes.map(s => {
                          const colTotal = m.colours.reduce((sum, c) => sum + (m.cells.get(`${c}||${s}`)?.quantity ?? 0), 0);
                          return <td key={s} className="text-center px-2 py-1.5">{colTotal > 0 ? colTotal : <span className="text-muted-foreground/30">—</span>}</td>;
                        })
                      : null}
                    <td className="text-center px-2 py-1.5">{items.filter(i => i.productName === m.productName).reduce((s, i) => s + i.quantity, 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ReadyOrderCard ─────────────────────────────────────────────────────────────
function ReadyOrderCard({ order, onSendToProduction, onReturnToPurchasing }: {
  order: AllReadyOrder;
  onSendToProduction: (order: AllReadyOrder) => void;
  onReturnToPurchasing: (order: AllReadyOrder) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0);
  const hasDecoration = order.items.some(i => i.finishId != null);

  return (
    <div className="rounded-xl border border-green-300 bg-green-50/40 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-green-50 transition-colors" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-green-600 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-green-600 flex-shrink-0" />}
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={`/orders/${order.id}`} className="font-mono font-bold text-base hover:underline text-foreground" onClick={e => e.stopPropagation()}>{order.orderNumber}</a>
              <Badge className="text-xs bg-green-100 text-green-800 border-green-400 gap-1"><CheckCircle2 className="w-3 h-3" />All stock in</Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {order.customerName && <span>{order.customerName}</span>}
              {order.requiredDate && <span>· Due {formatDate(order.requiredDate)}</span>}
              <span>· {totalUnits} unit{totalUnits !== 1 ? "s" : ""}</span>
              <span>· {formatCurrency(order.totalAmount)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <a href={`/orders/${order.id}`}><Button size="sm" variant="ghost" className="text-muted-foreground h-8 w-8 p-0"><ExternalLink className="w-3.5 h-3.5" /></Button></a>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => onReturnToPurchasing(order)}>
            <RotateCcw className="w-3.5 h-3.5" /> Return to Purchasing
          </Button>
          <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onSendToProduction(order)}>
            <ClipboardList className="w-3.5 h-3.5" /> {hasDecoration ? "Send to Production" : "Send to Dispatch"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-green-200 px-5 py-4">
          <ItemMatrix items={order.items} borderClass="border-green-200" headClass="bg-green-50/80 border-green-200" />
        </div>
      )}
    </div>
  );
}

// ─── PartInStockOrderCard ───────────────────────────────────────────────────────
function PartInStockOrderCard({ order, onSendToProduction }: {
  order: PartInStockOrder;
  onSendToProduction: (order: AllReadyOrder) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const readyUnits = order.readyItems.reduce((s, i) => s + i.quantity, 0);
  const pendingUnits = order.pendingItems.reduce((s, i) => s + i.purchaseQuantity, 0);
  const suppliers = [...new Set(order.pendingItems.map(i => i.supplierName).filter(Boolean))];

  const pendingMatrices = useMemo(() => {
    const map = new Map<string, { colours: string[]; sizes: string[]; cells: Map<string, PendingItem>; supplierName: string | null; supplierCode: string | null; productSku: string | null }>();
    for (const item of order.pendingItems) {
      if (!map.has(item.productName)) map.set(item.productName, { colours: [], sizes: [], cells: new Map(), supplierName: item.supplierName, supplierCode: item.supplierCode, productSku: item.productSku });
      const m = map.get(item.productName)!;
      const colour = item.colour ?? "";
      const size = item.size ?? "";
      if (!m.colours.includes(colour)) m.colours.push(colour);
      if (!m.sizes.includes(size)) m.sizes.push(size);
      const ck3 = `${colour}||${size}`;
      const ex3 = m.cells.get(ck3);
      m.cells.set(ck3, ex3 ? { ...ex3, quantity: ex3.quantity + item.quantity } : item);
    }
    for (const m of map.values()) m.sizes = sortSizes(m.sizes);
    return [...map.entries()].map(([productName, m]) => ({ productName, ...m }));
  }, [order.pendingItems]);

  return (
    <div className="rounded-xl border border-blue-300 bg-blue-50/30 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-blue-50 transition-colors" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-blue-600 flex-shrink-0" />}
          <Layers className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={`/orders/${order.id}`} className="font-mono font-bold text-base hover:underline text-foreground" onClick={e => e.stopPropagation()}>{order.orderNumber}</a>
              <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300 gap-1"><Layers className="w-3 h-3" />Part in stock</Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {order.customerName && <span>{order.customerName}</span>}
              {order.requiredDate && <span>· Due {formatDate(order.requiredDate)}</span>}
              <span className="text-green-700 font-medium">· {readyUnits} ready</span>
              <span className="text-amber-700 font-medium">· {pendingUnits} awaiting stock</span>
              {suppliers.length > 0 && <span>· from {suppliers.join(", ")}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <a href={`/orders/${order.id}`}><Button size="sm" variant="ghost" className="text-muted-foreground h-8 w-8 p-0"><ExternalLink className="w-3.5 h-3.5" /></Button></a>
          {order.readyItems.length > 0 && (
            <Button size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => onSendToProduction({ id: order.id, orderNumber: order.orderNumber, customerId: order.customerId, customerName: order.customerName, requiredDate: order.requiredDate, totalAmount: order.totalAmount, items: order.readyItems })}>
              <ClipboardList className="w-3.5 h-3.5" /> Send Ready Items
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-blue-200 px-5 py-4 space-y-4">
          {order.readyItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5 mb-2"><CheckCircle2 className="w-3.5 h-3.5" />{readyUnits} unit{readyUnits !== 1 ? "s" : ""} in stock — ready to produce</p>
              <ItemMatrix items={order.readyItems} borderClass="border-green-200" headClass="bg-green-50/80 border-green-200" />
            </div>
          )}
          {order.pendingItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-2"><ShoppingCart className="w-3.5 h-3.5" />{pendingUnits} unit{pendingUnits !== 1 ? "s" : ""} still awaiting stock</p>
              {pendingMatrices.map(m => {
                const hasSizes = m.sizes.some(s => s !== "");
                const hasColours = m.colours.some(c => c !== "");
                return (
                  <div key={m.productName} className="overflow-x-auto rounded-lg border border-amber-200 mb-2">
                    <div className="px-3 py-1.5 bg-amber-50/80 border-b border-amber-100 text-xs font-semibold flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span>{m.productName}</span>
                        {m.supplierCode && (
                          <span className="font-mono font-bold text-primary">{m.supplierCode}</span>
                        )}
                        {m.productSku && (
                          <span className="font-mono font-normal bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1 py-0.5">{m.productSku}</span>
                        )}
                      </div>
                      {m.supplierName && <span className="font-normal text-muted-foreground flex-shrink-0">{m.supplierName}</span>}
                    </div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-amber-50/40 border-b border-amber-100">
                          {hasColours && <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Colour</th>}
                          {hasSizes ? m.sizes.map(s => <th key={s} className="text-center px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">{s || "—"}</th>) : <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Qty</th>}
                          <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Total</th>
                          <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">PO Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.colours.map(colour => {
                          const existing = (hasSizes ? m.sizes : [""]).map(s => m.cells.get(`${colour}||${s}`)).filter(Boolean) as PendingItem[];
                          const rowTotal = existing.reduce((s, i) => s + i.purchaseQuantity, 0);
                          const po = existing.find(i => i.poStatus);
                          const delivery = existing.find(i => i.estimatedDelivery)?.estimatedDelivery;
                          return (
                            <tr key={colour} className="border-b border-amber-50 last:border-0">
                              {hasColours && <td className="px-3 py-1.5 font-medium whitespace-nowrap">{colour || "—"}</td>}
                              {(hasSizes ? m.sizes : [""]).map(s => {
                                const item = m.cells.get(`${colour}||${s}`);
                                return <td key={s} className="text-center px-2 py-1.5">{item ? <span className="font-semibold">{item.purchaseQuantity}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                              })}
                              <td className="text-center px-2 py-1.5 font-semibold">{rowTotal}</td>
                              <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                                {po?.poStatus === "ordered" ? <span className="text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Ordered{delivery ? ` · ${new Date(delivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                                : po?.poStatus === "draft" ? <span className="text-blue-700 flex items-center gap-1"><Clock className="w-3 h-3" />Draft PO</span>
                                 : po?.poStatus === "backorder" ? <span className="text-amber-700 flex items-center gap-1"><Clock className="w-3 h-3" />Backordered{delivery ? ` · ${new Date(delivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                                : <span className="text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Not yet ordered</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Print Picking Slip (renders into a new window) ───────────────────────────

function printPickingSlip(order: PickingOrder, allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Gather ALL orders for this customer (consolidate across all their orders)
  const customerOrders = order.customerName
    ? allOrders.filter(o => o.customerName === order.customerName)
    : [order];
  const allItems = customerOrders.flatMap(o => o.items);

  // Sort orders by required date for the order list header
  const sortedOrders = [...customerOrders].sort((a, b) => {
    if (!a.requiredDate && !b.requiredDate) return 0;
    if (!a.requiredDate) return 1;
    if (!b.requiredDate) return -1;
    return a.requiredDate.localeCompare(b.requiredDate);
  });
  const earliestDate = sortedOrders.find(o => o.requiredDate)?.requiredDate ?? null;

  // Group items by finish — each finish gets its own slip page
  const finishGroups = new Map<string, PickingItem[]>();
  for (const item of allItems) {
    const key = item.finishName ?? "Plain (No Finish)";
    if (!finishGroups.has(key)) finishGroups.set(key, []);
    finishGroups.get(key)!.push(item);
  }

  // Sort finishes alphabetically, Plain last
  const sortedFinishes = Array.from(finishGroups.keys()).sort((a, b) => {
    if (a === "Plain (No Finish)") return 1;
    if (b === "Plain (No Finish)") return -1;
    return a.localeCompare(b);
  });

  const thL = `background:#1e3a5f;color:white;padding:5px 8px;font-size:11px;text-align:left`;
  const thC = `background:#1e3a5f;color:white;padding:5px 8px;font-size:11px;text-align:center`;

  // Order summary line for the slip header
  const orderLines = sortedOrders.map(o => {
    const due = o.requiredDate
      ? new Date(o.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;
    const isUrgent = o.requiredDate === earliestDate && sortedOrders.length > 1;
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:16px${isUrgent ? ";font-weight:bold" : ""}">
      <span style="font-family:monospace;font-size:10px;color:#1e3a5f">${o.orderNumber}</span>
      ${due ? `<span style="font-size:10px;color:${isUrgent ? "#b45309" : "#555"}">${isUrgent ? "⚑ " : ""}Due: ${due}</span>` : ""}
    </span>`;
  }).join("");

  const slipPages = sortedFinishes.map((finishName, pageIdx) => {
    const items = finishGroups.get(finishName)!;

    // Matrix: group by product+colour, pivot sizes to columns
    type MatRowMeta = { supplierCode: string | null; productSku: string | null; productName: string; supplierName: string | null; colour: string | null };
    const matMap = new Map<string, { meta: MatRowMeta; sizes: Map<string, number> }>();
    const matSizes = new Set<string>();
    for (const item of items) {
      const key = [item.supplierCode ?? "", item.productSku ?? "", item.productName, item.colour ?? ""].join("||");
      if (!matMap.has(key)) {
        matMap.set(key, { meta: { supplierCode: item.supplierCode, productSku: item.productSku, productName: item.productName, supplierName: item.supplierName, colour: item.colour }, sizes: new Map() });
      }
      const sk = item.size ?? "—";
      matSizes.add(sk);
      matMap.get(key)!.sizes.set(sk, (matMap.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
    }
    const sortedMatSizes = sortSizes(Array.from(matSizes));
    const matRows = Array.from(matMap.values());
    const totalQty = matRows.reduce((s, r) => s + Array.from(r.sizes.values()).reduce((a, b) => a + b, 0), 0);
    const isLast = pageIdx === sortedFinishes.length - 1;

    const sizeHeaders = sortedMatSizes.map(s => `<th style="${thC}">${s}</th>`).join("");
    const itemRows = matRows.map(({ meta, sizes }, i) => {
      const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
      const codeSpan = meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:12px">${meta.supplierCode}</span>&nbsp;&nbsp;` : "";
      const skuSpan = meta.productSku ? `<span style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:3px;padding:1px 5px;font-size:10px;font-family:monospace">${meta.productSku}</span>&nbsp;&nbsp;` : "";
      const nameSpan = meta.supplierName ? `<span style="color:#555;font-size:10px">${meta.supplierName}</span>` : `<span style="color:#999;font-size:10px">${meta.productName}</span>`;
      const sizeCells = sortedMatSizes.map(s => {
        const qty = sizes.get(s) ?? 0;
        return `<td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center${qty > 0 ? ";font-weight:bold" : ";color:#ccc"}">${qty > 0 ? qty : "—"}</td>`;
      }).join("");
      return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${codeSpan}${skuSpan}${nameSpan}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${meta.colour ?? "—"}</td>
        ${sizeCells}
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:bold;background:#f0f4ff">${rowTotal}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">
          <span style="display:inline-block;width:22px;height:22px;border:1.5px solid #999;border-radius:3px">&nbsp;</span>
        </td>
      </tr>`;
    }).join("");

    return `
      <div class="slip${isLast ? "" : " page-break"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:4mm;margin-bottom:4mm">
          <div>
            <div style="font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1">${order.customerName ?? "Picking Slip"}</div>
            <div style="font-size:14px;font-weight:700;color:#374151;letter-spacing:0.5px;margin-top:1.5mm">PICKING SLIP</div>
            <div style="display:inline-block;margin-top:2mm;padding:2px 10px;background:#1e3a5f;color:white;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.5px">${finishName}</div>
            <div style="font-size:10px;color:#555;margin-top:2.5mm;line-height:1.8">${orderLines}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8mm">
            <div style="font-weight:bold;font-size:12px">Your business</div>
            <div style="color:#555;font-size:10px">Printed: ${dateStr}</div>
            ${earliestDate ? `<div style="margin-top:2mm;font-size:11px;font-weight:bold;color:#b45309">Required by: ${new Date(earliestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>` : ""}
            <div style="margin-top:1mm;font-size:10px;color:#555">${rows.length} line${rows.length !== 1 ? "s" : ""} · Qty <strong>${totalQty}</strong></div>
            ${sortedFinishes.length > 1 ? `<div style="margin-top:1mm;font-size:9px;color:#888">Slip ${pageIdx + 1} of ${sortedFinishes.length}</div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thL}">Supplier Code / SKU / Supplier</th>
            <th style="${thL}">Colour</th>
            <th style="${thC}">Size</th>
            <th style="${thC}">Qty</th>
            <th style="${thC}">Picked ✓</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="margin-top:8mm;display:flex;gap:30px;border-top:1px solid #e5e7eb;padding-top:4mm">
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Picked by: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Date picked: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Checked by: ___________________________</div>
        </div>
        <div style="margin-top:6mm;display:flex;justify-content:space-between;font-size:9px;color:#aaa;border-top:1px solid #f0f0f0;padding-top:3mm">
          <span>Your business — Internal Use Only</span>
          <span>${order.customerName ?? ""} · ${finishName} · ${dateStr}</span>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Picking Slip — ${order.customerName ?? order.orderNumber}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600;letter-spacing:.5px}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-print:hover{background:#16a34a}
      #btn-close{background:rgba(255,255,255,.15);color:white}#btn-close:hover{background:rgba(255,255,255,.25)}
      #page{display:flex;flex-direction:column;align-items:center;padding:24px 0 40px;gap:24px}
      .slip{background:white;padding:12mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:210mm}
      @media print{
        #toolbar{display:none}body{background:white}#page{padding:0;gap:0}
        .slip{box-shadow:none;width:100%;padding:0}
        .page-break{page-break-after:always}
        @page{size:A4 portrait;margin:12mm}
      }
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Picking Slip — ${order.customerName ?? order.orderNumber} · ${sortedFinishes.length} finish${sortedFinishes.length !== 1 ? "es" : ""} · ${customerOrders.length} order${customerOrders.length !== 1 ? "s" : ""}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print all ${sortedFinishes.length}</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page">${slipPages}</div>
  </body></html>`;

  const win = window.open("", "_blank", "width=960,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Dispatch-ready types & document print functions ──────────────────────────

interface DocEmployee { id: number; firstName: string; lastName: string | null; jobTitle: string | null; department: string | null; }
interface DocItem {
  id: number; orderId: number; productName: string; colour: string | null; size: string | null;
  finishName: string | null; quantity: number; recipientType: string; recipientName: string | null;
  recipientEmployeeId: number | null; unitPrice: number; lineTotal: number; employee: DocEmployee | null;
}
interface DocAddress { line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null; }
interface DocCustomer { name: string; address: string | null; city: string | null; state: string | null; postcode: string | null; email: string | null; phone: string | null; }
interface DocOrder {
  id: number; orderNumber: string; customerName: string | null; orderDate: string;
  requiredDate: string | null; totalAmount: number; notes: string | null;
  shippingMethod: string | null; trackingNumber: string | null;
  customer: DocCustomer | null; deliveryAddress: DocAddress | null; items: DocItem[];
}

const DOC_SHIPPING_LABELS: Record<string, string> = {
  free_local: "Free Local Delivery",
  local_delivery: "Local Delivery",
  office_collection: "Office Collection",
  warehouse_collection: "Warehouse Collection",
  courier: "Courier",
  dpd: "DPD Courier",
};
function docShippingLabel(method: string | null): string {
  if (!method) return "";
  return DOC_SHIPPING_LABELS[method] ?? method;
}

function docRecipientName(item: DocItem): string {
  if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
  return item.recipientName ?? "Unknown";
}

function openPreview(title: string, bodyHtml: string, styleCss: string, toolbarLabel: string) {
  const win = window.open("", "_blank", "width=960,height=800");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    *{box-sizing:border-box}
    body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar span{flex:1;font-size:14px;font-weight:600}
    #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
    #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
    #page{display:flex;justify-content:center;padding:24px 0 40px}
    #sheet{background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    @media print{#toolbar{display:none}body{background:white}#page{padding:0}#sheet{box-shadow:none}@page{size:A4;margin:20mm}}
    ${styleCss}
  </style></head><body>
    <div id="toolbar">
      <span>${toolbarLabel}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page"><div id="sheet">${bodyHtml}</div></div>
  </body></html>`);
  win.document.close();
  win.focus();
}

function openDeliveryNote(orderId: number, opts?: { dispatchedItemIds?: number[]; draft?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.dispatchedItemIds?.length) params.set("dispatchedItemIds", opts.dispatchedItemIds.join(","));
  if (opts?.draft) params.set("draft", "1");
  window.open(`/api/orders/${orderId}/delivery-note?${params}`, "_blank");
}

function printDocInvoice(order: DocOrder) {
  const dateStr = new Date().toLocaleDateString("en-AU");
  const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toLocaleDateString("en-AU");
  const customer = order.customer;
  const addr = order.deliveryAddress;
  const addrLines = addr ? [addr.line1, addr.line2, addr.city, addr.county, addr.postcode, addr.country].filter(Boolean) : [];
  const custAddrLines = customer ? [customer.address, customer.city, customer.state, customer.postcode].filter(Boolean) : [];
  const subtotal = order.items.reduce((s, i) => s + i.lineTotal, 0);
  const gst = subtotal * 0.1;
  const total = subtotal + gst;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const itemRows = order.items.map((i) => `
    <tr>
      <td>${i.productName}${i.finishName ? ` <span class="finish">${i.finishName}</span>` : ""}${i.colour || i.size ? `<br><span class="variant">${[i.colour, i.size].filter(Boolean).join(" / ")}</span>` : ""}</td>
      <td class="ctr">${i.quantity}</td>
      <td class="right">${fmt(i.unitPrice)}</td>
      <td class="right">${fmt(i.lineTotal)}</td>
    </tr>`).join("");

  openPreview(
    `Invoice — ${order.orderNumber}`,
    `<div style="padding:15mm">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:5mm;margin-bottom:5mm">
        <div><div style="font-size:22pt;font-weight:900;color:#1e3a5f">Your business</div><div style="font-size:9pt;color:#555;margin-top:2mm">Business identifier: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div></div>
        <div style="text-align:right"><div style="font-size:18pt;font-weight:bold;color:#333">INVOICE</div><div style="font-size:11pt;color:#555">${order.orderNumber}</div><div style="font-size:9pt;color:#888">Date: ${dateStr} · Due: ${dueDateStr}</div></div>
      </div>
      <div style="display:flex;gap:24px;margin-bottom:6mm">
        <div style="flex:1"><div class="lbl">Bill To</div><p><strong>${order.customerName ?? ""}</strong><br>${custAddrLines.length > 0 ? custAddrLines.join("<br>") : ""}<br>${customer?.email ? customer.email : ""}</p></div>
        <div style="flex:1"><div class="lbl">Deliver To</div><p>${addrLines.length > 0 ? addrLines.join("<br>") : "<em>Same as billing</em>"}</p></div>
        <div style="flex:1"><div class="lbl">Reference</div><p>Order: ${order.orderNumber}<br>${order.requiredDate ? `Required: ${new Date(order.requiredDate).toLocaleDateString("en-AU")}<br>` : ""}${order.shippingMethod ? `Delivery: ${docShippingLabel(order.shippingMethod)}` : ""}</p></div>
      </div>
      <table><thead><tr><th>Description</th><th class="ctr">Qty</th><th class="right">Unit Price</th><th class="right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody></table>
      <div style="display:flex;justify-content:flex-end;margin-top:4mm">
        <div style="width:220px">
          <div class="tot-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
          <div class="tot-row"><span>GST (10%)</span><span>${fmt(gst)}</span></div>
          <div class="tot-row total"><span>Total (inc. GST)</span><span>${fmt(total)}</span></div>
        </div>
      </div>
      <div style="margin-top:8mm;padding:4mm 5mm;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;font-size:9pt;color:#555">
        <strong>Payment Terms:</strong> Net 30 days from invoice date · EFT preferred · Please reference invoice number on payment.
      </div>
      <div style="margin-top:4mm;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:3mm">Your business · Thank you for your business.</div>
    </div>`,
    `.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px}
     table{width:100%;border-collapse:collapse;margin-top:8px}
     th{background:#1e3a5f;color:white;padding:5px 8px;text-align:left;font-size:9pt}th.ctr{text-align:center}th.right{text-align:right}
     td{padding:4px 8px;border-bottom:1px solid #e0e0e0;font-size:10pt}td.ctr{text-align:center}td.right{text-align:right}
     .variant{font-size:8pt;color:#888}.finish{font-size:9pt;color:#2563eb}
     .tot-row{display:flex;justify-content:space-between;padding:3px 0;font-size:10pt;border-bottom:1px solid #eee}
     .tot-row.total{font-size:12pt;font-weight:bold;border-bottom:none;margin-top:4px;color:#1e3a5f}`,
    `🧾 Invoice — ${order.customerName ?? order.orderNumber}`
  );
}

function openWearerLabels(orderId: number, opts?: { dispatchedItemIds?: number[] }) {
  const params = new URLSearchParams();
  if (opts?.dispatchedItemIds?.length) params.set("dispatchedItemIds", opts.dispatchedItemIds.join(","));
  window.open(`/api/orders/${orderId}/wearer-labels?${params}`, "_blank");
}

// ─── Interfaces for incomplete-order modal ─────────────────────────────────────

interface BackorderLine {
  id: number;
  poNumber: string;
  supplierName: string;
  productName: string;
  colour: string | null;
  size: string | null;
  remaining: number;
  estimatedDueDate: string | null;
}

// ─── Incomplete Order modal ────────────────────────────────────────────────────

function IncompleteOrderModal({
  order,
  incompleteItemIds,
  onClose,
}: {
  order: DocOrder;
  incompleteItemIds: number[];
  onClose: () => void;
}) {
  const completeItems = order.items.filter((i) => !incompleteItemIds.includes(i.id));
  const outstandingItems = order.items.filter((i) => incompleteItemIds.includes(i.id));
  const completeQty = completeItems.reduce((s, i) => s + i.quantity, 0);
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const namedCompleteCount = completeItems.filter(
    (i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId),
  ).length;

  const { data: backorders = [], isLoading: boLoading } = useQuery<BackorderLine[]>({
    queryKey: ["backorders", order.id],
    queryFn: () => apiFetch(`/orders/${order.id}/backorders`),
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dispatchDate = order.requiredDate
    ? (() => { const d = new Date(order.requiredDate); d.setHours(0, 0, 0, 0); return d; })()
    : null;
  const daysUntilDispatch = dispatchDate
    ? Math.round((dispatchDate.getTime() - today.getTime()) / 86400000)
    : null;
  const isImminent = daysUntilDispatch !== null && daysUntilDispatch <= 2;

  let recommendation: "wait" | "despatch" | "despatch_no_eta" | null = null;
  if (isImminent) {
    if (backorders.length > 0) {
      const dueDaysArr = backorders.map((b) =>
        b.estimatedDueDate
          ? Math.round((new Date(b.estimatedDueDate).setHours(0, 0, 0, 0) - today.getTime()) / 86400000)
          : null,
      );
      const withDate = dueDaysArr.filter((d): d is number => d !== null);
      const hasNoEta = dueDaysArr.some((d) => d === null);
      if (withDate.length > 0 && Math.min(...withDate) <= 3) {
        recommendation = "wait";
      } else if (hasNoEta && withDate.length === 0) {
        recommendation = "despatch_no_eta";
      } else {
        recommendation = "despatch";
      }
    } else {
      recommendation = "despatch";
    }
  }

  const completeOrder: DocOrder = { ...order, items: completeItems };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5" />
            Order Partially Complete
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Order summary */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <div className="font-semibold text-amber-900">{order.orderNumber}</div>
            <div className="text-sm text-amber-700">{order.customerName}</div>
            <div className="text-xs text-amber-600 mt-1">
              {completeItems.length} of {order.items.length} line{order.items.length !== 1 ? "s" : ""} complete
              {" · "}{completeQty} of {totalQty} item{totalQty !== 1 ? "s" : ""} ready
              {namedCompleteCount > 0 && ` · ${namedCompleteCount} named recipient${namedCompleteCount !== 1 ? "s" : ""}`}
            </div>
          </div>

          {/* Imminence + recommendation banner */}
          {isImminent && (
            <div
              className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
                daysUntilDispatch! < 0
                  ? "bg-red-50 border-red-200"
                  : "bg-orange-50 border-orange-200"
              }`}
            >
              <AlertCircle
                className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                  daysUntilDispatch! < 0 ? "text-red-600" : "text-orange-600"
                }`}
              />
              <div>
                <p
                  className={`text-sm font-semibold ${
                    daysUntilDispatch! < 0 ? "text-red-800" : "text-orange-800"
                  }`}
                >
                  {daysUntilDispatch! < 0
                    ? `Planned despatch was ${Math.abs(daysUntilDispatch!)} day${Math.abs(daysUntilDispatch!) !== 1 ? "s" : ""} ago`
                    : daysUntilDispatch === 0
                    ? "Planned despatch is today"
                    : `Planned despatch in ${daysUntilDispatch} day${daysUntilDispatch !== 1 ? "s" : ""}`}
                </p>
                {recommendation === "wait" && (
                  <p className="text-xs text-orange-700 mt-1">
                    Backorder items are due shortly — consider waiting to despatch together.
                  </p>
                )}
                {recommendation === "despatch" && (
                  <p className="text-xs text-orange-700 mt-1">
                    Backorder items are not due soon — suggest despatching ready items now and following up the remainder.
                  </p>
                )}
                {recommendation === "despatch_no_eta" && (
                  <p className="text-xs text-orange-700 mt-1">
                    No delivery date set for backorder items — suggest despatching ready items now and chasing the supplier.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Outstanding items */}
          {outstandingItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Outstanding Items ({outstandingItems.length})
              </p>
              <div className="space-y-1">
                {outstandingItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 text-sm rounded-md bg-muted/40 px-3 py-2"
                  >
                    <span className="flex-1 font-medium">{item.productName}</span>
                    {item.colour && <span className="text-xs text-muted-foreground">{item.colour}</span>}
                    {item.size && <span className="text-xs text-muted-foreground">{item.size}</span>}
                    <span className="text-xs font-semibold text-muted-foreground">×{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Purchase orders are managed in Purchasing; keep this production view focused on readiness. */}
          {!boLoading && backorders.length > 0 && (
            <a
              href="/purchasing?tab=ordered"
              className="inline-flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900 hover:underline"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {backorders.length} item{backorders.length !== 1 ? "s" : ""} on backorder — view in Purchasing
            </a>
          )}

          {/* Document & action buttons — wearer labels only; delivery note + box labels print at dispatch confirmation */}
          {namedCompleteCount > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Documents
              </p>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-auto py-3"
                  onClick={() => openWearerLabels(order.id, { dispatchedItemIds: completeOrder.items.map(i => i.id) })}
                >
                  <User className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Wearer Labels — Ready Items</div>
                    <div className="text-xs text-muted-foreground">
                      {namedCompleteCount} named recipient{namedCompleteCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => { window.location.href = "/order-system/dispatch?search=" + encodeURIComponent(order.orderNumber ?? ""); }}
          >
            <ArrowRight className="w-4 h-4" /> Go to Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ready to Dispatch modal ───────────────────────────────────────────────────

function ReadyToDispatchModal({ order, onClose }: { order: DocOrder; onClose: () => void }) {
  const namedCount = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)).length;
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tracking, setTracking] = useState<string>((order as any).trackingNumber ?? "");
  const [trackingSaved, setTrackingSaved] = useState(!!(order as any).trackingNumber);

  const saveTracking = useMutation({
    mutationFn: (tn: string | null) =>
      fetch(`${API_BASE}/invoices/${order.id}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: tn || null }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setTrackingSaved(true);
      qc.invalidateQueries({ queryKey: ["production-order", order.id] });
      toast({ title: "Tracking number saved" });
    },
    onError: () => toast({ title: "Failed to save tracking", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            Order Ready for Dispatch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <div className="font-semibold text-green-900">{order.orderNumber}</div>
            <div className="text-sm text-green-700">{order.customerName}</div>
            <div className="text-xs text-green-600 mt-1">
              {order.items.length} line{order.items.length !== 1 ? "s" : ""} · {totalQty} item{totalQty !== 1 ? "s" : ""}
              {namedCount > 0 && ` · ${namedCount} named recipient${namedCount !== 1 ? "s" : ""}`}
            </div>
          </div>

          {/* DPD Tracking Number — only shown when shipping method is DPD */}
          {order.shippingMethod === "dpd" && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                📦 DPD Tracking Number
                {trackingSaved && tracking && <span className="text-green-600 normal-case font-normal">(saved)</span>}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={tracking}
                  onChange={(e) => { setTracking(e.target.value); setTrackingSaved(false); }}
                  placeholder="e.g. 15006678987456"
                  className="h-8 text-xs font-mono flex-1"
                />
                <Button
                  size="sm"
                  variant={trackingSaved ? "outline" : "default"}
                  className="h-8 px-3 text-xs shrink-0"
                  onClick={() => saveTracking.mutate(tracking)}
                  disabled={saveTracking.isPending || trackingSaved}
                >
                  {saveTracking.isPending ? "Saving…" : trackingSaved ? "✓ Saved" : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Saved here, it will be included in the invoice email and shown on the customer's DPD tracking link.
              </p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">Print any documents you need, then head to Dispatch to confirm shipment — the delivery note and box labels will be produced automatically.</p>

          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3"
              onClick={() => printDocInvoice(order)}
            >
              <Archive className="w-4 h-4 text-purple-600 flex-shrink-0" />
              <div className="text-left">
                <div className="font-medium">Invoice</div>
                <div className="text-xs text-muted-foreground">Itemised with prices, GST, payment terms</div>
              </div>
            </Button>

            {namedCount > 0 && (
              <Button
                variant="outline"
                className="justify-start gap-2 h-auto py-3"
                onClick={() => openWearerLabels(order.id)}
              >
                <User className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-medium">Wearer Labels</div>
                  <div className="text-xs text-muted-foreground">{namedCount} named recipient{namedCount !== 1 ? "s" : ""} — one label per item</div>
                </div>
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            onClick={() => { window.location.href = "/order-system/dispatch?search=" + encodeURIComponent(order.orderNumber ?? ""); }}
          >
            <ArrowRight className="w-4 h-4" /> Go to Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Picking List Tab Component ───────────────────────────────────────────────

function PickingListTab({ filters, highlightOrderIds }: { filters: Filters; highlightOrderIds?: Set<number> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [returning, setReturning] = useState<Set<number>>(new Set());
  const [qtyOverrides, setQtyOverrides] = useState<Map<number, number>>(new Map());
  const [editingQty, setEditingQty] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"due_date" | "order_number" | "customer_name">("due_date");
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [processStockBlocker, setProcessStockBlocker] = useState<{ itemIds: number[]; missingNames: string } | null>(null);
  const highlightApplied = useRef(false);

  function toggleExpand(orderId: number) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  function setQtyOverride(itemId: number, qty: number, fullQty: number) {
    const normalizedQty = Math.max(0, qty);
    setQtyOverrides((prev) => {
      const next = new Map(prev);
      if (normalizedQty >= fullQty) next.delete(itemId);
      else next.set(itemId, normalizedQty);
      return next;
    });
    if (normalizedQty === 0) {
      setReturning((prev) => new Set(prev).add(itemId));
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } else {
      setReturning((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  const { data: rawPickingOrders = [], isLoading } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 15_000,
  });

  // Auto-select and expand orders that were just received (navigated from "What's Next" dialog)
  useEffect(() => {
    if (highlightApplied.current || !highlightOrderIds || highlightOrderIds.size === 0 || rawPickingOrders.length === 0) return;
    const matchingOrders = rawPickingOrders.filter(o => highlightOrderIds.has(o.orderId));
    if (matchingOrders.length === 0) return;
    highlightApplied.current = true;
    const itemIds = matchingOrders.flatMap(o => o.items.map(i => i.id));
    setChecked(new Set(itemIds));
    setExpandedOrders(new Set(matchingOrders.map(o => o.orderId)));
  }, [rawPickingOrders, highlightOrderIds]);

  const filteredPickingOrders = filterPickingOrders(rawPickingOrders, filters);

  const pickingOrders = [...filteredPickingOrders].sort((a, b) => {
    if (sortBy === "due_date") {
      if (!a.requiredDate && !b.requiredDate) return 0;
      if (!a.requiredDate) return 1;
      if (!b.requiredDate) return -1;
      return new Date(a.requiredDate).getTime() - new Date(b.requiredDate).getTime();
    }
    if (sortBy === "order_number") return a.orderNumber.localeCompare(b.orderNumber);
    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
  });

  const pickMutation = useMutation({
    mutationFn: ({ itemIds, bypass }: { itemIds: number[]; bypass?: boolean }) => {
      const qtyOverridesObj: Record<string, number> = {};
      for (const [id, qty] of qtyOverrides.entries()) {
        if (itemIds.includes(id)) qtyOverridesObj[String(id)] = qty;
      }
      return apiFetch("/picking-list/pick", {
        method: "POST",
        body: JSON.stringify({
          itemIds,
          ...(Object.keys(qtyOverridesObj).length > 0 ? { qtyOverrides: qtyOverridesObj } : {}),
          ...(bypass ? { bypassProcessStockCheck: true } : {}),
        }),
      });
    },
    onSuccess: (data: { ok: boolean; plainPicked: number; worksheetItems: number; worksheets?: Worksheet[] }, vars) => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      setChecked(new Set());
      setQtyOverrides(new Map());
      setProcessStockBlocker(null);
      const parts: string[] = [];
      if (data.plainPicked > 0) parts.push(`${data.plainPicked} ready for dispatch`);
      if (data.worksheetItems > 0) {
        parts.push(`${data.worksheetItems} sent to WIP`);
      }
      toast({ title: "Picked", description: parts.join(" · ") || "Items confirmed" });
      if (data.worksheets && data.worksheets.length > 0) {
        printWorksheetsFromData(data.worksheets);
      }
    },
    onError: (err: any, vars) => {
      let parsed: any = null;
      try { parsed = JSON.parse(err?.message ?? ""); } catch { /* */ }
      if (parsed?.missingProcessStock && !vars.bypass) {
        // Process stock is missing — offer "pick & hold in Pre-Production" option
        const names = (parsed.missingProcessStock as { name: string; sku?: string }[])
          .map(p => p.name + (p.sku ? ` (${p.sku})` : "")).join(", ");
        setProcessStockBlocker({ itemIds: vars.itemIds, missingNames: names });
        return;
      }
      const description = parsed?.error ?? err?.message ?? "An unexpected error occurred.";
      toast({ title: "Cannot send to production", description, variant: "destructive" });
    },
  });

  const returnMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/picking-list/return", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: (data: { ok: boolean; returned: number }) => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setReturning(new Set());
      setChecked(new Set());
      toast({
        title: "Returned to Purchasing",
        description: `${data.returned} item${data.returned !== 1 ? "s" : ""} de-allocated and added to purchasing requirements`,
      });
    },
    onError: () => toast({ title: "Error returning items", variant: "destructive" }),
  });


  function toggleReturning(id: number) {
    setReturning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setQtyOverrides((quantities) => {
          if (quantities.get(id) !== 0) return quantities;
          const updated = new Map(quantities);
          updated.delete(id);
          return updated;
        });
      } else {
        next.add(id);
        setChecked((selected) => {
          const updated = new Set(selected);
          updated.delete(id);
          return updated;
        });
      }
      return next;
    });
  }

  const allItemIds = pickingOrders.flatMap((o) => o.items.map((i) => i.itemId));

  function toggleItem(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleOrder(order: PickingOrder) {
    const ids = order.items.map((i) => i.itemId);
    const allChecked = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === allItemIds.length) setChecked(new Set());
    else setChecked(new Set(allItemIds));
  }

  const totalItems = pickingOrders.reduce((s, o) => s + o.items.length, 0);
  const rawTotalItems = rawPickingOrders.reduce((s, o) => s + o.items.length, 0);

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
    </div>
  );

  if (rawTotalItems === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <ListChecks className="w-12 h-12 text-purple-300" />
      <p className="text-lg font-medium">No items to pick</p>
      <p className="text-sm text-center max-w-xs">Items allocated from delivered stock will appear here for warehouse picking.</p>
    </div>
  );

  if (totalItems === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <Search className="w-12 h-12 text-purple-200" />
      <p className="text-lg font-medium">No results match your filters</p>
      <p className="text-sm text-center max-w-xs">{rawTotalItems} item{rawTotalItems !== 1 ? "s" : ""} exist but none match the current filter.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Toolbar: sort + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            {checked.size === allItemIds.length && allItemIds.length > 0
              ? <CheckSquare className="w-5 h-5 text-primary" />
              : <Square className="w-5 h-5" />}
          </button>
          <span className="text-sm text-muted-foreground mr-1">
            {checked.size > 0 ? `${checked.size} of ${totalItems} selected` : `${totalItems} item${totalItems !== 1 ? "s" : ""}`}
          </span>
          {/* Sort pills */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            {(["due_date", "order_number", "customer_name"] as const).map((key) => {
              const labels = { due_date: "Due Date", order_number: "Order #", customer_name: "Customer" };
              return (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sortBy === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {labels[key]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {returning.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
              onClick={() => returnMutation.mutate([...returning])}
              disabled={returnMutation.isPending}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Return {returning.size} to Purchasing
            </Button>
          )}
          {checked.size > 0 && (() => {
            const checkedItems = pickingOrders.flatMap((o) => o.items).filter((i) => checked.has(i.itemId));
            const needsWorksheet = checkedItems.some((i) => i.finishId != null);
            const plainCount = checkedItems.filter((i) => i.finishId == null).length;
            const finishCount = checkedItems.filter((i) => i.finishId != null).length;
            const label = needsWorksheet && plainCount > 0
              ? `Pick — ${plainCount} dispatch, ${finishCount} production`
              : needsWorksheet
              ? `Pick → Production (${finishCount})`
              : `Confirm ${checked.size} Picked`;
            return (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-indigo-500 text-indigo-700 hover:bg-indigo-50 font-semibold"
                  onClick={() => printPerCustomerPickingSlips(checkedItems, rawPickingOrders)}
                  title="Print one picking slip per customer — one page per customer, sorted by required date"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Picking Slips ({new Set(checkedItems.map(i => i.customerName ?? String(i.orderId))).size} customer{new Set(checkedItems.map(i => i.customerName ?? String(i.orderId))).size !== 1 ? "s" : ""})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-gray-300 text-gray-500 hover:bg-gray-50"
                  onClick={() => printCombinedPickingSlip(checkedItems, rawPickingOrders)}
                  title="Print one combined picking slip across all selected items"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Combined
                </Button>
                <Button
                  size="sm"
                  onClick={() => pickMutation.mutate({ itemIds: [...checked] })}
                  disabled={pickMutation.isPending}
                  className={`gap-1.5 text-white ${needsWorksheet ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {label}
                </Button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Order rows */}
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {pickingOrders.map((order) => {
          const orderChecked = order.items.every((i) => checked.has(i.itemId));
          const orderPartial = order.items.some((i) => checked.has(i.itemId)) && !orderChecked;
          const isExpanded = expandedOrders.has(order.orderId);
          const dueDate = order.requiredDate
            ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : null;
          const isOverdue = order.requiredDate ? new Date(order.requiredDate) < new Date(new Date().toDateString()) : false;
          const isToday = order.requiredDate
            ? new Date(order.requiredDate).toDateString() === new Date().toDateString()
            : false;

          return (
            <div key={order.orderId}>
              {/* Collapsed row — always visible */}
              <div
                className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20 ${isExpanded ? "bg-muted/20" : ""}`}
              >
                <button
                  onClick={() => toggleOrder(order)}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Select all items in this order"
                >
                  {orderChecked
                    ? <CheckSquare className="w-4.5 h-4.5 text-primary" />
                    : orderPartial
                    ? <CheckSquare className="w-4.5 h-4.5 text-primary/50" />
                    : <Square className="w-4.5 h-4.5" />}
                </button>

                {/* Order number */}
                <span className="font-semibold text-sm w-16 flex-shrink-0">{order.orderNumber}</span>

                {/* Customer name */}
                <span className="flex-1 text-sm text-foreground truncate min-w-0">{order.customerName ?? "—"}</span>

                {/* Due date */}
                <span className={`text-sm flex-shrink-0 font-medium ${isOverdue ? "text-red-600" : isToday ? "text-orange-600" : "text-muted-foreground"}`}>
                  {dueDate ?? <span className="text-muted-foreground/50 font-normal">No due date</span>}
                </span>

                {/* Item count */}
                <span className="text-xs text-muted-foreground flex-shrink-0 w-16 text-right">
                  {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                </span>

                {/* Print Slip */}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-7 px-2.5 flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); printPickingSlip(order, rawPickingOrders); }}
                >
                  <Printer className="w-3 h-3" /> Print Slip
                </Button>

                {/* Expand toggle */}
                <button
                  onClick={() => toggleExpand(order.orderId)}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 p-1 rounded hover:bg-muted"
                  title={isExpanded ? "Collapse items" : "Expand items"}
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>

              {/* Expanded items */}
              {isExpanded && (
                <div className="divide-y divide-border border-t border-border bg-muted/5">
                  {order.items.map((item) => {
                    const isReturning = returning.has(item.itemId);
                    return (
                      <div key={item.itemId}>
                        <div className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${checked.has(item.itemId) ? "bg-green-50/60" : isReturning ? "bg-amber-50/60" : ""}`}>
                          <div className="w-4 flex-shrink-0" /> {/* indent spacer */}
                          <button
                            onClick={() => { if (!isReturning) toggleItem(item.itemId); }}
                            disabled={isReturning}
                            className={`flex-shrink-0 transition-colors ${isReturning ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:text-foreground"}`}
                            title={isReturning ? "This item is being returned to Purchasing" : "Select for picking"}
                          >
                            {checked.has(item.itemId)
                              ? <CheckSquare className="w-4 h-4 text-green-600" />
                              : <Square className="w-4 h-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{item.productName}</span>
                              {item.finishName ? (
                                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                                  <Sparkles className="w-3 h-3" />{item.finishName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 border border-green-200 rounded px-1.5 py-0.5 font-medium">
                                  Plain Stock
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {/* Stock + Bin indicator — always shown on picking list */}
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-600 text-white rounded px-2 py-0.5 tracking-wide uppercase">
                                <Box className="w-3 h-3" />
                                Stock
                                {item.binLocation && (
                                  <span className="ml-0.5 bg-white/20 rounded px-1.5 py-px font-black tracking-wider">
                                    BIN {item.binLocation}
                                  </span>
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Palette className="w-3 h-3" />{item.colour ?? "—"}
                              </span>
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Ruler className="w-3 h-3" />{item.size ?? "—"}
                              </span>
                              {item.recipientName && (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <User className="w-3 h-3" />{item.recipientName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {editingQty === item.itemId ? (
                              <input
                                type="number"
                                min={0}
                                max={item.quantity}
                                defaultValue={qtyOverrides.get(item.itemId) ?? item.quantity}
                                autoFocus
                                className="w-14 h-7 text-center text-sm font-bold border border-primary rounded px-1 focus:outline-none focus:ring-1 focus:ring-primary"
                                onBlur={(e) => {
                                  const v = parseInt(e.target.value);
                                  if (!isNaN(v)) setQtyOverride(item.itemId, v, item.quantity);
                                  setEditingQty(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setEditingQty(null);
                                }}
                              />
                            ) : (
                              <button
                                onClick={() => setEditingQty(item.itemId)}
                                title="Click to edit quantity picked"
                                className={`min-w-[2rem] h-7 px-2 rounded text-sm font-bold transition-colors border ${
                                  qtyOverrides.has(item.itemId)
                                    ? "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200"
                                    : "bg-secondary text-secondary-foreground border-transparent hover:bg-muted hover:border-border"
                                }`}
                              >
                                {qtyOverrides.get(item.itemId) ?? item.quantity}
                              </button>
                            )}
                            {qtyOverrides.has(item.itemId) && (
                              <span className="text-xs text-amber-700 font-medium whitespace-nowrap">
                                shortfall: {item.quantity - (qtyOverrides.get(item.itemId) ?? item.quantity)}
                              </span>
                            )}
                            <button
                              onClick={() => toggleReturning(item.itemId)}
                              title="Stock not found — return whole item to purchasing"
                              className={`p-1 rounded transition-colors ${isReturning ? "text-amber-600 bg-amber-100" : "text-muted-foreground hover:text-amber-600 hover:bg-amber-50"}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {isReturning && (
                          <div className="flex items-center gap-2 pl-16 pr-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>This item will be de-allocated and added to purchasing requirements. Product stock will be corrected.</span>
                            <button onClick={() => toggleReturning(item.itemId)} className="ml-auto text-amber-600 hover:text-amber-800 underline whitespace-nowrap">Cancel</button>
                          </div>
                        )}
                        {qtyOverrides.has(item.itemId) && !isReturning && (
                          <div className="flex items-center gap-2 pl-16 pr-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>
                              Picking <strong>{qtyOverrides.get(item.itemId)}</strong> of {item.quantity} — shortfall of <strong>{item.quantity - (qtyOverrides.get(item.itemId) ?? item.quantity)}</strong> will be added to purchasing requirements.
                            </span>
                            <button onClick={() => setQtyOverride(item.itemId, item.quantity, item.quantity)} className="ml-auto text-amber-600 hover:text-amber-800 underline whitespace-nowrap">Reset</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Process stock missing — offer pick & hold in Pre-Production */}
      <Dialog open={!!processStockBlocker} onOpenChange={(open) => { if (!open) setProcessStockBlocker(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Process Stock Not Yet Delivered
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              The garments are in stock and can be picked, but the following process stock hasn't arrived yet:
            </p>
            <p className="font-medium text-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {processStockBlocker?.missingNames}
            </p>
            <p>
              You can pick the garments now and the worksheet will go straight to <strong>Work in Progress</strong>. It will sit in WIP until the process stock arrives and you're ready to decorate.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setProcessStockBlocker(null)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
              disabled={pickMutation.isPending}
              onClick={() => {
                if (processStockBlocker) {
                  pickMutation.mutate({ itemIds: processStockBlocker.itemIds, bypass: true });
                }
              }}
            >
              <ClipboardList className="w-4 h-4" />
              Pick &amp; Send to WIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Daily Work Plan ────────────────────────────────────────────────────────────

const URGENCY_CONFIG = {
  overdue:   { label: "Overdue — Act Now",      bg: "bg-red-50",     border: "border-red-200",   dot: "bg-red-500",    text: "text-red-700",   badge: "bg-red-100 text-red-800 border-red-200" },
  today:     { label: "Due Today",              bg: "bg-orange-50",  border: "border-orange-200", dot: "bg-orange-500", text: "text-orange-700", badge: "bg-orange-100 text-orange-800 border-orange-200" },
  soon:      { label: "Due in 1–2 Days",        bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-500",  text: "text-amber-700",  badge: "bg-amber-100 text-amber-800 border-amber-200" },
  this_week: { label: "Due This Week",          bg: "bg-blue-50",    border: "border-blue-200",   dot: "bg-blue-400",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-800 border-blue-200" },
  upcoming:  { label: "Upcoming",               bg: "bg-muted/30",   border: "border-border",     dot: "bg-gray-400",   text: "text-foreground", badge: "bg-muted text-muted-foreground border-border" },
} as const;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  in_progress: { label: "In Progress",   color: "bg-amber-100 text-amber-800 border-amber-200" },
  ready:       { label: "Ready to Start", color: "bg-green-100 text-green-800 border-green-200" },
  pick_first:  { label: "Needs Picking",  color: "bg-purple-100 text-purple-800 border-purple-200" },
  mixed:       { label: "Mixed Stages",   color: "bg-gray-100 text-gray-700 border-gray-200" },
};

const TASK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  picking: { label: "Picking List", color: "text-purple-600" },
  pre_wip: { label: "Work in Progress", color: "text-amber-600" },
  wip:     { label: "In Progress",  color: "text-amber-600" },
};

function daysLabel(days: number | null): string {
  if (days === null) return "No due date";
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function TaskGroupCard({
  group,
  onNavigate,
}: {
  group: PlanTaskGroup;
  onNavigate: (tab: string, search?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const urg = URGENCY_CONFIG[group.urgency];
  const stat = STATUS_LABELS[group.overallStatus] ?? STATUS_LABELS.mixed;

  const actionLabel =
    group.overallStatus === "pick_first" ? "Go to Picking List" :
    group.overallStatus === "in_progress" ? "View in WIP" :
    "View in Pre-Production";

  const actionTab =
    group.overallStatus === "pick_first" ? "picking_list" :
    group.overallStatus === "in_progress" ? "wip" :
    "pre_wip";

  return (
    <div className={`rounded-xl border ${urg.border} ${urg.bg} shadow-sm overflow-hidden`}>
      {/* Customer name header */}
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base">{group.customerName || group.finishName}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${stat.color}`}>
              {stat.label}
            </span>
            <span className={`text-sm font-medium ${urg.text}`}>
              {daysLabel(group.daysUntilDue)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1"
            onClick={() => {
              const wsNum = group.overallStatus === "in_progress"
                ? (group.tasks[0]?.worksheetNumber ?? undefined)
                : undefined;
              onNavigate(actionTab, wsNum);
            }}
          >
            {group.overallStatus === "in_progress" ? <Play className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
            {actionLabel}
          </Button>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="p-1 rounded hover:bg-black/5 text-muted-foreground"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Finish rows */}
      <div className={`border-t ${urg.border} divide-y`} style={{ borderColor: "inherit" }}>
        {(group.finishes ?? group.tasks).map((finish, i) => {
          const isFinish = "finishName" in finish && !("items" in finish);
          const label = isFinish ? (finish as PlanFinish).finishName : ((finish as typeof group.tasks[0]).finishName ?? (finish as typeof group.tasks[0]).worksheetNumber ?? "—");
          const wsNum = isFinish ? (finish as PlanFinish).worksheetNumber : (finish as typeof group.tasks[0]).worksheetNumber;
          const qty = finish.qty;
          const type = finish.type;
          const tLabel = TASK_TYPE_LABELS[type] ?? TASK_TYPE_LABELS.picking;
          const taskItems = !isFinish && expanded ? (finish as typeof group.tasks[0]).items : [];

          return (
            <div key={i} className="px-5 py-2.5 flex items-start gap-3">
              <div className="w-2.5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {wsNum && (
                    <span className="font-mono text-xs text-muted-foreground">{wsNum}</span>
                  )}
                  <span className="font-medium text-foreground truncate">{label}</span>
                  <span className={`text-xs font-medium ${tLabel.color}`}>{tLabel.label}</span>
                  <span className="ml-auto font-semibold text-foreground flex-shrink-0">{qty} item{qty !== 1 ? "s" : ""}</span>
                </div>
                {expanded && taskItems.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {taskItems.map((item, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs text-muted-foreground pl-2 border-l-2 border-muted">
                        <span className="font-medium text-foreground">{item.productName}</span>
                        {item.colour && <span>{item.colour}</span>}
                        {item.size && <span>/ {item.size}</span>}
                        {item.recipient && <span className="ml-auto">→ {item.recipient}</span>}
                        <span className="font-semibold text-foreground">×{item.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyPlanTab({ onNavigate, pendingCount, readyCount }: { onNavigate: (tab: string, search?: string) => void; pendingCount: number; readyCount: number }) {
  const { data: plan, isLoading } = useQuery<DailyPlan>({
    queryKey: ["daily-plan"],
    queryFn: () => apiFetch("/production/daily-plan"),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Building your work plan…
      </div>
    );
  }

  if (!plan || plan.taskGroups.length === 0) {
    const totalWaiting = pendingCount + readyCount;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
        <CheckCircle2 className="w-14 h-14 text-green-300" />
        <p className="text-lg font-medium">No active production work</p>
        {totalWaiting > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 max-w-md text-center space-y-2">
            <p className="text-sm font-medium text-amber-800">
              {readyCount > 0 && pendingCount > 0
                ? `${readyCount} order${readyCount !== 1 ? "s" : ""} ready for production · ${pendingCount} awaiting stock`
                : readyCount > 0
                  ? `${readyCount} confirmed order${readyCount !== 1 ? "s" : ""} ready to send to production`
                  : `${pendingCount} confirmed order${pendingCount !== 1 ? "s" : ""} waiting for stock to arrive`}
            </p>
            <button
              onClick={() => onNavigate("pre_wip")}
              className="text-sm font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              View in Pre-Production →
            </button>
          </div>
        ) : (
          <p className="text-sm text-center max-w-sm">
            All clear! When orders are confirmed and items are allocated to stock, your daily work plan will appear here.
          </p>
        )}
      </div>
    );
  }

  const { summary } = plan;
  const urgentGroups  = plan.taskGroups.filter((g) => g.urgency === "overdue");
  const todayGroups   = plan.taskGroups.filter((g) => g.urgency === "today");
  const soonGroups    = plan.taskGroups.filter((g) => g.urgency === "soon");
  const weekGroups    = plan.taskGroups.filter((g) => g.urgency === "this_week");
  const upcomingGroups = plan.taskGroups.filter((g) => g.urgency === "upcoming");

  const needsActionNow = summary.overdue + summary.today + summary.soon;

  return (
    <div className="space-y-6">
      {/* ── Summary banner ── */}
      <div className={`rounded-xl border p-4 flex flex-wrap items-center gap-4 ${needsActionNow > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
        <div className="flex items-center gap-2">
          {needsActionNow > 0
            ? <AlertTriangle className="w-5 h-5 text-red-600" />
            : <CheckCircle2 className="w-5 h-5 text-green-600" />
          }
          <span className={`font-semibold ${needsActionNow > 0 ? "text-red-700" : "text-green-700"}`}>
            {needsActionNow > 0
              ? `${needsActionNow} process batch${needsActionNow !== 1 ? "es" : ""} need attention now`
              : "All urgent work is under control"}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-auto flex-wrap text-sm">
          {summary.overdue > 0   && <span className="flex items-center gap-1 text-red-700 font-medium"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{summary.overdue} overdue</span>}
          {summary.today > 0     && <span className="flex items-center gap-1 text-orange-700 font-medium"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />{summary.today} due today</span>}
          {summary.soon > 0      && <span className="flex items-center gap-1 text-amber-700 font-medium"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />{summary.soon} due soon</span>}
          {summary.thisWeek > 0  && <span className="flex items-center gap-1 text-blue-700 font-medium"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />{summary.thisWeek} this week</span>}
          {summary.upcoming > 0  && <span className="flex items-center gap-1 text-muted-foreground"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />{summary.upcoming} upcoming</span>}
        </div>
      </div>

      {/* Batching tip */}
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 border border-border px-4 py-3 text-sm text-muted-foreground">
        <Layers className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Batch for efficiency —</span>{" "}
          Jobs with the same finish are grouped together below. Complete all items in a group in one run rather than returning to them across multiple shifts.
        </span>
      </div>

      {/* ── Overdue ── */}
      {urgentGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="font-semibold text-red-700">Overdue — Complete Immediately</h3>
          </div>
          {urgentGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Due today ── */}
      {todayGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-600" />
            <h3 className="font-semibold text-orange-700">Due Today — Start First</h3>
          </div>
          {todayGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Due soon (next 2 working days) ── */}
      {soonGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-amber-700">Due in Next 2 Working Days — Plan Today</h3>
          </div>
          {soonGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Later work (not shown in Today's Plan) ── */}
      {(weekGroups.length > 0 || upcomingGroups.length > 0) && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex items-center gap-3 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span>
            <span className="font-medium text-foreground">
              {weekGroups.length + upcomingGroups.length} further batch{weekGroups.length + upcomingGroups.length !== 1 ? "es" : ""} later this week / upcoming
            </span>
            {" "}— not due within the next 2 working days. View them in the <button className="underline text-primary font-medium" onClick={() => onNavigate("wip")}>Work in Progress</button> tab.
          </span>
        </div>
      )}
    </div>
  );
}

export default function Production() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") ?? "plan";
  });
  const highlightOrderIds = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("highlight");
    if (!raw) return undefined;
    const ids = raw.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
    return ids.length > 0 ? new Set(ids) : undefined;
  }, []);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [wsSort, setWsSort] = useState<"number_asc" | "created_desc" | "due_date">("number_asc");
  const [readyOrder, setReadyOrder] = useState<DocOrder | null>(null);
  const [partialOrder, setPartialOrder] = useState<{ order: DocOrder; incompleteItemIds: number[] } | null>(null);

  const { data: allWorksheets = [], isLoading: wsLoading } = useQuery<Worksheet[]>({
    queryKey: ["worksheets"],
    queryFn: () => apiFetch("/worksheets"),
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery<{
    allReady: AllReadyOrder[];
    partInStock: PartInStockOrder[];
    allAwaitingStock: PendingOrder[];
  }>({
    queryKey: ["production-pending"],
    queryFn: () => apiFetch("/production/pending"),
  });
  const allReadyOrders    = pendingData?.allReady ?? [];
  const partInStockOrders = pendingData?.partInStock ?? [];
  const allAwaitingOrders = pendingData?.allAwaitingStock ?? [];

  const [sendingOrder, setSendingOrder] = useState<AllReadyOrder | null>(null);
  const [sendingNotes, setSendingNotes] = useState("");
  const [sendingExcluded, setSendingExcluded] = useState<Set<number>>(new Set());
  const [sendAllConfirmOpen, setSendAllConfirmOpen] = useState(false);
  const [sendAllInProgress, setSendAllInProgress] = useState(false);

  const returnReadyOrderMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/picking-list/return", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: (_data: any, itemIds: number[]) => {
      queryClient.invalidateQueries({ queryKey: ["production-pending"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      toast({ title: "Returned to Awaiting Stock", description: `${itemIds.length} item line${itemIds.length !== 1 ? "s" : ""} returned to purchasing` });
    },
    onError: () => toast({ title: "Error returning items", variant: "destructive" }),
  });


  const createWorksheetMutation = useMutation({
    mutationFn: (data: { orderId: number; orderNumber: string; customerId: number | null; customerName: string | null; notes: string; itemIds: number[]; returnItemIds: number[] }) =>
      apiFetch("/worksheets", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: async (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["production-pending"] });
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setSendingOrder(null);
      setSendingNotes("");
      setSendingExcluded(new Set());
      if (data.worksheetNumber) {
        toast({ title: `Worksheet ${data.worksheetNumber} created`, description: "Printing worksheet now…" });
        printWorksheetFromData(data as Worksheet);
      } else {
        // Plain items — no worksheet created. Check if the order is now fully ready for dispatch.
        try {
          const result = await apiFetch<{ isComplete: boolean; incompleteItemIds: number[]; order: DocOrder }>(
            `/dispatch/orders/${variables.orderId}/ready`,
          );
          if (result.isComplete) {
            setReadyOrder(result.order);
          } else {
            toast({ title: "Items sent to dispatch", description: `${data.plainCompleted ?? 0} plain item line${(data.plainCompleted ?? 0) !== 1 ? "s" : ""} marked ready` });
          }
        } catch {
          toast({ title: "Items sent to dispatch", description: `${data.plainCompleted ?? 0} plain item line${(data.plainCompleted ?? 0) !== 1 ? "s" : ""} marked ready` });
        }
      }
    },
    onError: (e: Error) => {
      if (e.message?.includes("already have a worksheet")) {
        // Stale page — these items were already sent to production since this page loaded.
        // Close the dialog and refresh so the user sees the current state.
        setSendingOrder(null);
        setSendingNotes("");
        setSendingExcluded(new Set());
        queryClient.invalidateQueries({ queryKey: ["production-pending"] });
        queryClient.invalidateQueries({ queryKey: ["worksheets"] });
        toast({
          title: "Page refreshed",
          description: "Those items were already sent to production — the page has been updated.",
        });
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  const { data: pickingOrders = [] } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 15_000,
  });

  const pickingCount = pickingOrders.reduce((s, o) => s + o.items.length, 0);

  const isLoading = wsLoading || pendingLoading;

  const statusMutation = useMutation({
    mutationFn: ({ id, status, orderId: _orderId }: { id: number; status: string; orderId?: number | null }) =>
      apiFetch(`/worksheets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      if (variables.status === "complete" && variables.orderId) {
        toast({ title: "Worksheet complete — checking order status…" });
        try {
          const result = await apiFetch<{ isComplete: boolean; incompleteItemIds: number[]; order: DocOrder }>(`/dispatch/orders/${variables.orderId}/ready`);
          if (result.isComplete) {
            setReadyOrder(result.order);
          } else {
            setPartialOrder({ order: result.order, incompleteItemIds: result.incompleteItemIds });
          }
        } catch {
          toast({ title: "Worksheet marked complete" });
        }
      } else {
        toast({ title: "Status updated" });
      }
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  // Pre-production (pre_wip) worksheets stay in pre_wip until staff manually
  // move them to WIP via the "Move to WIP" button on the worksheet card.
  // This happens when process stock (embroidery thread, DTF transfers, etc.) has arrived.

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/worksheets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      toast({ title: "Worksheet deleted" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const returnToPickingMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/worksheets/${id}/return-to-picking`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      toast({ title: "Returned to Picking List", description: "Items moved back to the picking list." });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  async function handleSendAll() {
    setSendAllInProgress(true);
    setSendAllConfirmOpen(false);
    const results = await Promise.allSettled(
      filteredAllReady.map(order =>
        apiFetch<any>("/worksheets", {
          method: "POST",
          body: JSON.stringify({
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            customerName: order.customerName,
            notes: "",
            itemIds: order.items.map((i: ReadyItemSummary) => i.id),
            returnItemIds: [],
          }),
        })
      )
    );
    let created = 0, failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        created++;
        if (result.value?.worksheetNumber) {
          printWorksheetFromData(result.value as Worksheet);
        }
      } else {
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["production-pending"] });
    queryClient.invalidateQueries({ queryKey: ["worksheets"] });
    queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
    setSendAllInProgress(false);
    toast({
      title: failed === 0
        ? `${created} order${created !== 1 ? "s" : ""} sent to production`
        : `${created} sent, ${failed} failed`,
      description: failed > 0
        ? "Some orders could not be sent — check them individually."
        : created > 0 ? "Worksheets created and printing now." : undefined,
      variant: failed > 0 ? "destructive" : undefined,
    });
  }

  const handleDelete = (id: number) => {
    if (!confirm("Delete this worksheet?")) return;
    deleteMutation.mutate(id);
  };

  const handleReturnToPicking = (id: number) => {
    if (!confirm("Return all items in this worksheet back to the Picking List?")) return;
    returnToPickingMutation.mutate(id);
  };

  // When a search term is active, ignore the process-type pill so the search
  // sweeps all WIP (DTF + Embroidery + Print) rather than just the active type.
  const filtersForWorksheets = filters.search ? { ...filters, process: "" } : filters;
  const preWipWorksheets = filterWorksheets(allWorksheets.filter((w) => w.status === "pre_wip"), filtersForWorksheets);
  const wip = filterWorksheets(allWorksheets.filter((w) => w.status === "wip"), filtersForWorksheets);
  const complete = filterWorksheets(allWorksheets.filter((w) => w.status === "complete"), filtersForWorksheets);

  const filterBySearchAndDate = <T extends { customerName: string | null; orderNumber: string; requiredDate: string | Date | null }>(arr: T[]): T[] =>
    arr.filter((o) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!o.customerName?.toLowerCase().includes(q) && !o.orderNumber.toLowerCase().includes(q)) return false;
      }
      if (!matchesDateFilters(o.requiredDate as unknown as string | null, filters.dateFrom, filters.dateTo)) return false;
      return true;
    });

  const filteredAllReady     = filterBySearchAndDate(allReadyOrders);
  const filteredPartInStock  = filterBySearchAndDate(partInStockOrders);
  const filteredAllAwaiting  = filterBySearchAndDate(allAwaitingOrders.map(o => ({ ...o, orderNumber: o.orderNumber, customerName: o.customerName, requiredDate: o.requiredDate })));

  const preWipTotal = filteredAllReady.length + filteredPartInStock.length;

  // Unfiltered counts for stat cards (show actual total, filtered shown inside tab)
  const rawPreWip = allReadyOrders.length + partInStockOrders.length;
  const rawWip = allWorksheets.filter((w) => w.status === "wip").length;
  const rawComplete = allWorksheets.filter((w) => w.status === "complete").length;
  const hasFilters = Object.values(filters).some(Boolean);

  // Process quantity breakdowns for stat cards
  const wipQty      = computeProcessQty(allWorksheets.filter((w) => w.status === "wip"));
  const preWipQty   = computeProcessQty(allWorksheets.filter((w) => w.status === "pre_wip"));
  const completeQty = computeProcessQty(allWorksheets.filter((w) => w.status === "complete"));
  const pickingQtyTotal = pickingOrders.reduce((s, o) => s + o.items.reduce((si, i) => si + (i.quantity ?? 1), 0), 0);

  const { data: dailyPlan } = useQuery<DailyPlan>({
    queryKey: ["daily-plan"],
    queryFn: () => apiFetch("/production/daily-plan"),
    refetchInterval: 15_000,
  });

  const urgentPlanCount = dailyPlan?.summary.urgentCount ?? 0;
  const planQtyTotal    = dailyPlan?.summary.urgentItems ?? urgentPlanCount;

  const TAB_COUNTS = [
    { key: "plan",         label: "Today's Plan",      count: urgentPlanCount,                            qty: planQtyTotal,        byType: {} as Record<string,number>, icon: Zap,          color: "text-primary" },
    { key: "picking_list", label: "Picking List",       count: pickingCount,                               qty: pickingQtyTotal,     byType: {} as Record<string,number>, icon: ListChecks,   color: "text-purple-600" },
    { key: "pre_wip",      label: "Pre-Production",     count: hasFilters ? preWipTotal : rawPreWip,       qty: preWipQty.total,    byType: preWipQty.byType,           icon: Clock,         color: "text-blue-600" },
    { key: "wip",          label: "Work in Progress",   count: hasFilters ? wip.length : rawWip,           qty: wipQty.total,       byType: wipQty.byType,              icon: ClipboardList,  color: "text-amber-600" },
    { key: "complete",     label: "Complete",           count: hasFilters ? complete.length : rawComplete, qty: completeQty.total,  byType: completeQty.byType,         icon: CheckCircle2,   color: "text-green-600" },
  ];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["worksheets"] });
    queryClient.invalidateQueries({ queryKey: ["production-pending"] });
    queryClient.invalidateQueries({ queryKey: ["picking-list"] });
    queryClient.invalidateQueries({ queryKey: ["daily-plan"] });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="w-7 h-7 text-primary" />
              Production
            </h1>
            <p className="text-muted-foreground mt-1">Your daily work plan — batched by process for maximum efficiency.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {TAB_COUNTS.map((t) => {
            const Icon = t.icon;
            const processEntries = Object.entries(t.byType).sort(([a], [b]) => a.localeCompare(b));
            return (
              <div
                key={t.key}
                className={`rounded-xl border bg-card p-4 cursor-pointer transition-all ${activeTab === t.key ? "border-primary shadow-md" : "border-border hover:border-primary/40"}`}
                onClick={() => setActiveTab(t.key)}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${t.color}`} />
                  <span className="font-medium text-sm">{t.label}</span>
                </div>
                <div className={`text-3xl font-bold mt-1 ${t.color}`}>{t.qty}</div>
                {processEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {processEntries.map(([type, qty]) => {
                      const col = PROCESS_COLOURS[type] ?? { bg: "bg-muted", text: "text-muted-foreground", border: "border-border", label: type };
                      const isActive = activeTab === t.key && filters.process === type;
                      return (
                        <button
                          key={type}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTab(t.key);
                            setFilters(f => ({ ...f, process: f.process === type ? "" : type }));
                          }}
                          className={`text-xs font-semibold px-1.5 py-0.5 rounded border transition-all ${col.bg} ${col.text} ${col.border} ${isActive ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-80 hover:opacity-100 hover:ring-1 hover:ring-current"}`}
                        >
                          {col.label} {qty}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            {TAB_COUNTS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                {t.label}
                {t.count > 0 && <Badge variant="secondary" className="ml-1 text-xs">{t.count}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>

          {activeTab !== "plan" && (
            <div className="mt-3">
              <FiltersBar filters={filters} onChange={setFilters} />
            </div>
          )}

          {/* ── Today's Plan Tab ── */}
          <TabsContent value="plan">
            <DailyPlanTab
              onNavigate={(tab, search) => {
                if (search) setFilters(f => ({ ...f, search }));
                setActiveTab(tab);
              }}
              pendingCount={allAwaitingOrders.length + partInStockOrders.length}
              readyCount={allReadyOrders.length}
            />
          </TabsContent>

          {/* ── Pre-Production Tab ── */}
          <TabsContent value="pre_wip">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : preWipTotal === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Clock className="w-12 h-12 text-blue-300" />
                <p className="text-lg font-medium">Nothing in Pre-Production</p>
                <p className="text-sm text-center max-w-xs">
                  Orders will appear here once stock has been received and allocated. Pick the items and create a worksheet to send them to production.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAllReady.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
                        <CheckCircle2 className="w-4 h-4" />
                        Ready to Pick &amp; Worksheet ({filteredAllReady.length} order{filteredAllReady.length !== 1 ? "s" : ""})
                      </div>
                      {filteredAllReady.length >= 2 && (
                        <Button
                          size="sm"
                          className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                          disabled={sendAllInProgress}
                          onClick={() => setSendAllConfirmOpen(true)}
                        >
                          {sendAllInProgress
                            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            : <ClipboardList className="w-3.5 h-3.5" />}
                          {sendAllInProgress ? "Sending…" : `Send All ${filteredAllReady.length} to Production`}
                        </Button>
                      )}
                    </div>
                    {filteredAllReady.map((order) => (
                      <ReadyOrderCard
                        key={order.id}
                        order={order}
                        onSendToProduction={setSendingOrder}
                        onReturnToPurchasing={(o) => returnReadyOrderMutation.mutate(o.items.map(i => i.id))}
                      />
                    ))}
                  </>
                )}
                {filteredPartInStock.length > 0 && (
                  <>
                    {filteredAllReady.length > 0 && <div className="pt-1" />}
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                      <Layers className="w-4 h-4" />
                      Part in Stock — Pick Available ({filteredPartInStock.length} order{filteredPartInStock.length !== 1 ? "s" : ""})
                    </div>
                    {filteredPartInStock.map((order) => (
                      <PartInStockOrderCard key={order.id} order={order} onSendToProduction={setSendingOrder} />
                    ))}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── WIP Tab — grouped by order/job number ── */}
          <TabsContent value="wip">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : wip.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <ClipboardList className="w-12 h-12 text-amber-300" />
                <p className="text-lg font-medium">No active worksheets</p>
                <p className="text-sm text-center max-w-xs">Worksheets appear here once garments have been picked. Mark them complete when decoration is finished.</p>
              </div>
            ) : (() => {
              const sortedWip = sortWorksheets(wip, wsSort);
              // Group WIP worksheets by order
              type WipGroup = { orderNumber: string; customerName: string | null; requiredDate: string | null; orderId: number | null; worksheets: Worksheet[]; minKey: number };
              const wipGroupMap = new Map<string, WipGroup>();
              for (const ws of sortedWip) {
                const key = ws.orderNumber ?? `ws-${ws.id}`;
                if (!wipGroupMap.has(key)) {
                  const minKey = wsSort === "number_asc"
                    ? parseInt(ws.worksheetNumber.replace(/\D/g, ""), 10) || 0
                    : wsSort === "created_desc"
                    ? -new Date(ws.createdAt).getTime()
                    : new Date(ws.requiredDate ?? "9999").getTime();
                  wipGroupMap.set(key, { orderNumber: ws.orderNumber ?? "—", customerName: ws.customerName, requiredDate: ws.requiredDate, orderId: ws.orderId, worksheets: [], minKey });
                }
                wipGroupMap.get(key)!.worksheets.push(ws);
              }
              const wipGroups = Array.from(wipGroupMap.values()).sort((a, b) => a.minKey - b.minKey);
              return (
                <div className="space-y-4">
                  <WsSortBar sort={wsSort} onChange={setWsSort} />
                  {wipGroups.map((group) => (
                    <div key={group.orderNumber} className="rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm overflow-hidden">
                      {/* Order header */}
                      <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200">
                        <div className="flex items-center gap-3 min-w-0">
                          <ClipboardList className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {group.orderId ? (
                                <a href={`/orders/${group.orderId}`} className="font-mono font-bold text-base hover:underline text-foreground">
                                  {group.orderNumber}
                                </a>
                              ) : (
                                <span className="font-mono font-bold text-base">{group.orderNumber}</span>
                              )}
                              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                                {group.worksheets.length} worksheet{group.worksheets.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                              {group.customerName && <span>{group.customerName}</span>}
                              {group.requiredDate && <span>· Due {formatDate(group.requiredDate)}</span>}
                              <span className="text-amber-700 font-medium">· {group.worksheets.map(w => w.worksheetNumber).join(", ")}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Worksheets list */}
                      <div className="divide-y divide-amber-100">
                        {group.worksheets.map((ws) => (
                          <WorksheetCard
                            key={ws.id}
                            ws={ws}
                            onStatusChange={(id, s) => statusMutation.mutate({ id, status: s, orderId: ws.orderId })}
                            onDelete={handleDelete}
                            onReturnToPicking={handleReturnToPicking}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </TabsContent>

          {/* ── Picking List Tab ── */}
          <TabsContent value="picking_list">
            <PickingListTab filters={filters} highlightOrderIds={highlightOrderIds} />
          </TabsContent>

          {/* ── Complete Tab ── */}
          <TabsContent value="complete">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : complete.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <CheckCircle2 className="w-12 h-12 text-green-300" />
                <p className="text-lg font-medium">No completed worksheets yet</p>
                <p className="text-sm text-center max-w-xs">Completed worksheets will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <WsSortBar sort={wsSort} onChange={setWsSort} />
                {sortWorksheets(complete, wsSort).map((ws) => (
                  <WorksheetCard
                    key={ws.id}
                    ws={ws}
                    onStatusChange={(id, s) => statusMutation.mutate({ id, status: s, orderId: ws.orderId })}
                    onDelete={handleDelete}
                    onReturnToPicking={handleReturnToPicking}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {sendAllConfirmOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setSendAllConfirmOpen(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                Send All to Production
              </DialogTitle>
            </DialogHeader>
            <div className="py-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                This will send all <strong>{filteredAllReady.length} orders</strong> to production at once. A worksheet will be created and printed for each decorated order; plain stock orders will be confirmed for dispatch.
              </p>
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠️ All items for every order will be included with no notes. To exclude individual items or add notes, use the per-order buttons instead.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendAllConfirmOpen(false)}>Cancel</Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                onClick={handleSendAll}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Send All {filteredAllReady.length} to Production
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {sendingOrder && (() => {
        const includedItems = sendingOrder.items.filter(i => !sendingExcluded.has(i.id));
        const excludedItems = sendingOrder.items.filter(i => sendingExcluded.has(i.id));
        const hasDecoration = includedItems.some(i => i.finishId != null);
        const includedPlainCount = includedItems.filter(i => i.finishId == null).length;
        const includedDecoratedCount = includedItems.filter(i => i.finishId != null).length;
        const closeSendingDialog = () => { setSendingOrder(null); setSendingNotes(""); setSendingExcluded(new Set()); };
        return (
          <Dialog open onOpenChange={(open) => { if (!open) closeSendingDialog(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  {hasDecoration ? "Send to Production" : "Confirm Stock"} — {sendingOrder.orderNumber}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Tick the items that are physically in stock and ready. Unticked items will be <strong>returned to purchasing</strong>.
                </p>
                {hasDecoration && includedPlainCount > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span className="mt-0.5 text-amber-500">⚠</span>
                    <span>
                      <strong>{includedDecoratedCount} item{includedDecoratedCount !== 1 ? "s" : ""}</strong> will go on the production worksheet.{" "}
                      <strong>{includedPlainCount} plain item{includedPlainCount !== 1 ? "s" : ""} (no finish)</strong> will be sent straight to dispatch — they won't appear on the worksheet.
                    </span>
                  </div>
                )}
                <div className="space-y-3">
                  {buildSendMatrix(sendingOrder.items).map(group => {
                    const getRowCells = (colour: string) =>
                      group.sizes.map(s => group.cells.get(`${colour}|${s}`)).filter(Boolean) as SendMatrixCell[];
                    const rowAllIncluded = (colour: string) =>
                      getRowCells(colour).every(c => !sendingExcluded.has(c.itemId));
                    const rowSomeIncluded = (colour: string) =>
                      getRowCells(colour).some(c => !sendingExcluded.has(c.itemId));
                    const toggleRow = (colour: string) => {
                      const cells = getRowCells(colour);
                      const allIn = cells.every(c => !sendingExcluded.has(c.itemId));
                      setSendingExcluded(prev => {
                        const next = new Set(prev);
                        cells.forEach(c => allIn ? next.add(c.itemId) : next.delete(c.itemId));
                        return next;
                      });
                    };
                    return (
                      <div key={group.key} className="rounded-lg border border-border overflow-hidden">
                        <div className="px-3 py-2 bg-slate-800 flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{group.productName}</span>
                          {group.finishName && <span className="text-xs text-blue-300">✦ {group.finishName}</span>}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="bg-slate-100 border-b border-border">
                                <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Colour</th>
                                {group.sizes.map(s => (
                                  <th key={s} className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap min-w-[56px]">{s}</th>
                                ))}
                                <th className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.colours.map((colour, ri) => {
                                const allIn = rowAllIncluded(colour);
                                const someIn = rowSomeIncluded(colour);
                                const rowTotal = group.sizes.reduce((sum, s) => sum + (group.cells.get(`${colour}|${s}`)?.qty ?? 0), 0);
                                return (
                                  <tr key={colour} className={`border-b border-border last:border-0 ${ri % 2 === 0 ? "bg-white" : "bg-slate-50/60"} ${!someIn ? "opacity-40" : ""}`}>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={allIn}
                                          ref={el => { if (el) el.indeterminate = someIn && !allIn; }}
                                          onChange={() => toggleRow(colour)}
                                          className="h-4 w-4 rounded border-gray-300 accent-green-600"
                                        />
                                        <span className="font-medium text-sm">{colour}</span>
                                      </label>
                                    </td>
                                    {group.sizes.map(s => {
                                      const cell = group.cells.get(`${colour}|${s}`);
                                      if (!cell) return (
                                        <td key={s} className="px-2 py-2 text-center text-muted-foreground/40 text-xs">—</td>
                                      );
                                      const included = !sendingExcluded.has(cell.itemId);
                                      return (
                                        <td key={s} className="px-2 py-2 text-center">
                                          <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={included}
                                              onChange={() => setSendingExcluded(prev => {
                                                const next = new Set(prev);
                                                if (next.has(cell.itemId)) next.delete(cell.itemId); else next.add(cell.itemId);
                                                return next;
                                              })}
                                              className="h-3.5 w-3.5 rounded border-gray-300 accent-green-600"
                                            />
                                            <span className={`text-xs font-semibold tabular-nums ${included ? "" : "line-through text-muted-foreground"}`}>×{cell.qty}</span>
                                          </label>
                                        </td>
                                      );
                                    })}
                                    <td className="px-2 py-2 text-center font-bold text-sm tabular-nums text-slate-700">×{rowTotal}</td>
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
                {includedItems.length === 0 && (
                  <p className="text-sm text-amber-600 font-medium text-center">Select at least one item to continue.</p>
                )}
                {excludedItems.length > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    ⚠️ {excludedItems.length} unticked item{excludedItems.length !== 1 ? "s" : ""} will be returned to purchasing and removed from stock allocation.
                  </p>
                )}
                {hasDecoration && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ws-notes" className="text-sm">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="ws-notes"
                      placeholder="Special instructions, artwork notes…"
                      value={sendingNotes}
                      onChange={e => setSendingNotes(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeSendingDialog}>Cancel</Button>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  disabled={createWorksheetMutation.isPending || includedItems.length === 0}
                  onClick={() => createWorksheetMutation.mutate({
                    orderId: sendingOrder.id,
                    orderNumber: sendingOrder.orderNumber,
                    customerId: sendingOrder.customerId,
                    customerName: sendingOrder.customerName,
                    notes: sendingNotes,
                    itemIds: includedItems.map(i => i.id),
                    returnItemIds: excludedItems.map(i => i.id),
                  })}
                >
                  {createWorksheetMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                  {hasDecoration
                    ? `Create Worksheet${includedItems.length < sendingOrder.items.length ? ` (${includedItems.length} of ${sendingOrder.items.length})` : ""}`
                    : `Confirm — Send to Dispatch${includedItems.length < sendingOrder.items.length ? ` (${includedItems.length} of ${sendingOrder.items.length})` : ""}`
                  }
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {readyOrder && (
        <ReadyToDispatchModal order={readyOrder} onClose={() => setReadyOrder(null)} />
      )}
      {partialOrder && (
        <IncompleteOrderModal
          order={partialOrder.order}
          incompleteItemIds={partialOrder.incompleteItemIds}
          onClose={() => setPartialOrder(null)}
        />
      )}
    </Layout>
  );
}
