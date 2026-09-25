import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useUpload } from "@workspace/object-storage-web";
import { ProcessStockTab } from "@/pages/ProcessStock";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Package, AlertTriangle, CheckCircle, Mail, ChevronDown, ChevronRight,
  RefreshCw, Plus, FileText, Truck, Clock, TriangleAlert, Trash2, ArrowRight,
  CalendarDays, PackageCheck, Send, Loader2, ChevronUp, TrendingUp, ClipboardList, Layers, Boxes, Paperclip, Upload,
  CheckCircle2, ListChecks, Sparkles, StickyNote, Ban, Search, X, Pencil, RotateCcw, PackagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate, cn } from "@/lib/utils";
import { useListSuppliers } from "@workspace/api-client-react";
import { printWorksheetsFromData } from "@/utils/printWorksheet";
import { UploadedImage } from "@/components/UploadedImage";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface PurchaseRequirement {
  itemId: number; orderId: number; orderNumber: string | null; customerName: string | null;
  productId: number | null; productName: string; colour: string | null; size: string | null;
  purchaseQuantity: number | null; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  supplierCode: string | null; secondarySupplierCode: string | null; productSku: string | null; canonicalProductName: string | null;
  supplierPrice: number | null;
  unitPrice: number | null;
  orderCreatedAt: string | null;
  queuedAt: string | null;
  isManual?: boolean;
}
interface SupplierGroup {
  supplierId: number | null; supplierName: string; supplierEmail: string | null; supplierCurrency: string; items: PurchaseRequirement[];
}

interface PORecipientInfo {
  orderItemId: number;
  orderNumber: string | null;
  recipientName: string;
  quantity: number;
}

interface POItem {
  id: number; poId: number; orderItemId: number | null; orderId: number | null; orderNumber: string | null;
  customerName: string | null;
  productName: string; colour: string | null; size: string | null;
  supplierCode: string | null; supplierPrice: number | null;
  productSku: string | null; canonicalProductName: string | null;
  processStockId: number | null; processStockFileUrl: string | null;
  quantityOrdered: number; quantityDelivered: number; estimatedDueDate: string | null; notes: string | null;
  recipients?: PORecipientInfo[];
}

interface PurchaseOrder {
  id: number; poNumber: string; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  supplierCurrency: string;
  status: "draft" | "ordered" | "delivered"; notes: string | null; sentAt: string | null;
  estimatedDeliveryDate: string | null;
  attachments: Array<{ name: string; objectPath: string }> | null;
  createdAt: string; updatedAt: string; items: POItem[];
}

interface AllocationResult {
  ordersAffected: number;
  pickingItems: number;
  worksheetsCreated: number;
  worksheetsUpdated: number;
  summary: Array<{
    orderId: number;
    orderNumber: string;
    customerName: string | null;
    worksheetNumber: string | null;
    pickingCount: number;
    worksheetCount: number;
  }>;
}

function currencySymbol(currency?: string | null): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "£";
}

interface ProcessStockRequirement {
  processStockId: number;
  name: string;
  sku: string | null;
  stockQuantity: number;
  supplierId: number | null;
  supplierName: string | null;
  fileUrl: string | null;
  totalNeeded: number;
  shortfall: number;
  orders: Array<{ orderId: number; orderNumber: string; customerName: string | null; requiredDate: string | null; qty: number }>;
}

interface BackorderLine {
  id: number;
  poId: number;
  poNumber: string;
  supplierName: string;
  supplierEmail: string | null;
  sentAt: string | null;
  productName: string;
  productId: number | null;
  colour: string | null;
  size: string | null;
  supplierCode: string | null;
  quantityOrdered: number;
  quantityDelivered: number;
  remaining: number;
  estimatedDueDate: string | null;
  daysOverdue: number | null;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
  secondarySupplierName: string | null;
  secondarySupplierEmail: string | null;
}

const STATUS_CFG = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700 border-slate-300", icon: FileText },
  ordered: { label: "Ordered", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Send },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-800 border-green-300", icon: PackageCheck },
};

const SIZE_NORMALIZE: Record<string, string> = {
  "one size": "One Size", "os": "One Size", "o/s": "One Size", "onesize": "One Size",
  "x-small": "XS", "xsmall": "XS", "extra small": "XS",
  "small": "S",
  "medium": "M",
  "large": "L",
  "x-large": "XL", "xlarge": "XL", "extra large": "XL", "extra-large": "XL",
  "xxl": "2XL", "xx-large": "2XL", "2x-large": "2XL",
  "xxxl": "3XL", "xxx-large": "3XL", "3x-large": "3XL",
  "xxxxl": "4XL", "xxxx-large": "4XL", "4x-large": "4XL",
  "xxxxxl": "5XL", "5x-large": "5XL",
  "extra small youth": "Extra Small Youth", "xs youth": "Extra Small Youth", "xsy": "Extra Small Youth",
  "small youth": "Small Youth", "s youth": "Small Youth", "sy": "Small Youth",
  "medium youth": "Medium Youth", "m youth": "Medium Youth", "my": "Medium Youth",
  "large youth": "Large Youth", "l youth": "Large Youth", "ly": "Large Youth",
  "extra large youth": "Extra Large Youth", "xl youth": "Extra Large Youth", "xly": "Extra Large Youth",
  "xxl youth": "2XL Youth", "2xl youth": "2XL Youth",
};
const SIZE_ORDER = [
  "One Size",
  "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL",
  "Extra Small Youth", "Small Youth", "Medium Youth", "Large Youth", "Extra Large Youth", "2XL Youth",
];
function normalizeSize(s: string): string { return SIZE_NORMALIZE[s.toLowerCase().trim()] ?? s; }
function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a); const bi = SIZE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    // Numeric sizes (shoe sizes, inches, etc.) — sort numerically not lexicographically
    const an = parseFloat(a); const bn = parseFloat(b);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

// ── Auto-print slip after booking in a PO line ──────────────────────────────
// Fetches the picking list filtered to the affected orders and opens a print
// window with a per-customer picking slip (same format as Production page).
// Alias to avoid name collision with the local sortSizes declared below
const sortSizesLocal = (sizes: string[]) => {
  const SIZE_ORDER_LOCAL = ["XXS","XS","S","M","L","XL","2XL","XXL","3XL","XXXL","4XL","5XL","6XL","7XL","8XL",
    "One Size","OS","Free Size","6","7","8","9","10","11","12","13","14","15","16",
    "3/4 Sleeve","Short Sleeve","Long Sleeve","Regular","Slim","Tailored"];
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER_LOCAL.indexOf(a), bi = SIZE_ORDER_LOCAL.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    const an = parseFloat(a), bn = parseFloat(b);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
};

async function printBookInSlip(affectedOrderIds: number[]) {
  if (affectedOrderIds.length === 0) return;
  let pickingList: any[];
  try {
    pickingList = await fetch(`${API_BASE}/picking-list`).then(r => r.json());
  } catch { return; }

  // Filter to only the orders affected by this book-in
  const idSet = new Set(affectedOrderIds);
  const relevantOrders = (pickingList as any[]).filter((o: any) => idSet.has(o.orderId));
  if (relevantOrders.length === 0) return;

  // Auto-pick decorated items so the production worksheet is created immediately.
  // Plain items stay on the picking list (warehouse staff physically pulls them later).
  const decoratedItemIds = relevantOrders.flatMap((o: any) =>
    (o.items as any[]).filter((i: any) => i.finishId != null).map((i: any) => i.itemId)
  );
  if (decoratedItemIds.length > 0) {
    try {
      const pickResult = await fetch(`${API_BASE}/picking-list/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: decoratedItemIds }),
      }).then(r => r.json());
      // Print all worksheets in a single window (one per page)
      if (pickResult?.worksheets?.length > 0) {
        printWorksheetsFromData(pickResult.worksheets);
      }
    } catch { /* non-fatal — slip still prints below */ }
  }

  const dateStr = new Date().toLocaleDateString("en-GB");
  const thStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:center;white-space:nowrap`;
  const thLeftStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:left`;
  const tdStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:10px`;
  const tdLeftStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;font-size:10px`;

  const slipPages = relevantOrders.map((order: any, pageIdx: number) => {
    const items: any[] = order.items ?? [];
    const totalQty = items.reduce((s: number, i: any) => s + i.quantity, 0);
    const requiredDate = order.requiredDate
      ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;

    // Group by finish
    const finishMap = new Map<string, any[]>();
    for (const item of items) {
      const fk = item.finishName ?? "Plain (No Finish)";
      if (!finishMap.has(fk)) finishMap.set(fk, []);
      finishMap.get(fk)!.push(item);
    }
    const finishKeys = Array.from(finishMap.keys()).sort((a, b) => {
      if (a === "Plain (No Finish)") return 1;
      if (b === "Plain (No Finish)") return -1;
      return a.localeCompare(b);
    });

    const finishSections = finishKeys.map(finishName => {
      const fItems = finishMap.get(finishName)!;
      const matMap = new Map<string, { meta: any; sizes: Map<string, number> }>();
      const matSizes = new Set<string>();
      for (const item of fItems) {
        const key = [item.supplierCode ?? "", item.productSku ?? "", item.productName, item.colour ?? ""].join("||");
        if (!matMap.has(key)) matMap.set(key, { meta: item, sizes: new Map() });
        const sk = item.size ?? "—";
        matSizes.add(sk);
        matMap.get(key)!.sizes.set(sk, (matMap.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
      }
      const sortedSizes = sortSizesLocal(Array.from(matSizes));
      const matRows = Array.from(matMap.values());
      const finishTotal = fItems.reduce((s: number, i: any) => s + i.quantity, 0);
      const sizeHeaders = sortedSizes.map(s => `<th style="${thStyle}">${s}</th>`).join("");
      const tableRows = matRows.map(({ meta, sizes }, i) => {
        const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
        const sizeCells = sortedSizes.map(s => {
          const qty = sizes.get(s) ?? 0;
          return `<td style="${tdStyle}${qty > 0 ? ";font-weight:bold" : ";color:#bbb"}">${qty > 0 ? qty : "—"}</td>`;
        }).join("");
        return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
          <td style="${tdLeftStyle}">
            ${meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:10px">${meta.supplierCode}</span> ` : ""}
            ${meta.productSku ? `<span style="font-size:9px;color:#2563eb">${meta.productSku}</span><br>` : ""}
            ${meta.binLocation ? `<span style="font-size:9px;color:#059669;font-weight:bold">📦 ${meta.binLocation}</span><br>` : ""}
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
              ${sizeHeaders}
              <th style="${thStyle};background:#1e3a5f">Total</th>
              <th style="${thStyle}">Picked ✓</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
          <div style="text-align:right;font-size:9px;color:#888;margin-top:1mm">${matRows.length} style${matRows.length !== 1 ? "s" : ""} · ${finishTotal} unit${finishTotal !== 1 ? "s" : ""}</div>
        </div>`;
    }).join("");

    const hasDecoration = items.some((i: any) => i.finishId != null);
    const isLast = pageIdx === relevantOrders.length - 1;
    return `
      <div class="slip${isLast ? "" : " page-break"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:3mm;margin-bottom:3mm">
          <div>
            <div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1.1">${order.customerName ?? "Unknown Customer"}</div>
            <div style="font-size:11px;font-weight:700;color:#374151;letter-spacing:0.5px;margin-top:1.5mm">${hasDecoration ? "PICKING SLIP — FOR PRODUCTION" : "PICKING SLIP"}</div>
            <div style="font-size:10px;color:#555;margin-top:2mm">
              <span style="font-family:monospace;font-size:10px;color:#1e3a5f">${order.orderNumber}</span>
              ${requiredDate ? `&nbsp;·&nbsp;<span style="color:#b45309;font-weight:bold">Due: ${requiredDate}</span>` : ""}
            </div>
            <div style="font-size:10px;color:#666;margin-top:1mm">${finishKeys.length} finish${finishKeys.length !== 1 ? "es" : ""} &nbsp;·&nbsp; Total qty <strong>${totalQty}</strong></div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8mm">
            <div style="font-weight:bold;font-size:12px">Your business</div>
            <div style="color:#555;font-size:10px">Booked in: ${dateStr}</div>
            ${hasDecoration ? `<div style="margin-top:2mm;padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:3px;font-size:10px;font-weight:600">⚙ Needs decoration</div>` : `<div style="margin-top:2mm;padding:2px 8px;background:#dcfce7;color:#166534;border-radius:3px;font-size:10px;font-weight:600">✓ Ready to pick &amp; dispatch</div>`}
          </div>
        </div>
        ${finishSections}
        <div style="margin-top:6mm;display:flex;gap:24px;border-top:1px solid #e5e7eb;padding-top:3mm">
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Picked by: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Date picked: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Checked by: ___________________________</div>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Picking Slip — Booked In</title>
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
      <span>📋 Picking Slip — ${relevantOrders.length} order${relevantOrders.length !== 1 ? "s" : ""} booked in</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page">${slipPages}</div>
    <script>window.onload=function(){window.print();};<\/script>
  </body></html>`;

  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

type POCellInfo = {
  orderNumber: string | null;
  customerName: string | null;
  recipients: PORecipientInfo[];
};

function buildPOMatrix(items: POItem[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, {
    code: string | null; productName: string; productSku: string | null; price: number | null;
    colours: string[]; sizes: string[];
    qty: Map<string, Map<string, number>>;
    rowItemIds: Map<string, number[]>;
    cellItemId: Map<string, Map<string, number>>;
    cellNote: Map<string, Map<string, string | null>>;
    cellInfo: Map<string, Map<string, POCellInfo>>;
    rowInfo: Map<string, POCellInfo[]>;
  }>();
  for (const item of items) {
    const gk = item.supplierCode ?? item.productName;
    if (!groups.has(gk)) {
      groupKeys.push(gk);
      groups.set(gk, { code: item.supplierCode, productName: item.canonicalProductName ?? item.productName, productSku: item.productSku ?? null, price: item.supplierPrice, colours: [], sizes: [], qty: new Map(), rowItemIds: new Map(), cellItemId: new Map(), cellNote: new Map(), cellInfo: new Map(), rowInfo: new Map() });
    }
    const g = groups.get(gk)!;
    const c = item.colour ?? "—"; const s = normalizeSize(item.size ?? "—");
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    if (!g.qty.has(c)) g.qty.set(c, new Map());
    g.qty.get(c)!.set(s, (g.qty.get(c)!.get(s) ?? 0) + item.quantityOrdered);
    if (item.supplierPrice != null && g.price == null) g.price = item.supplierPrice;
    if (!g.rowItemIds.has(c)) g.rowItemIds.set(c, []);
    g.rowItemIds.get(c)!.push(item.id);
    if (!g.cellItemId.has(c)) g.cellItemId.set(c, new Map());
    g.cellItemId.get(c)!.set(s, item.id);
    if (!g.cellNote.has(c)) g.cellNote.set(c, new Map());
    g.cellNote.get(c)!.set(s, item.notes ?? null);
    // Order info for tooltips
    const info: POCellInfo = {
      orderNumber: item.orderNumber,
      customerName: item.customerName,
      recipients: item.recipients ?? [],
    };
    if (!g.cellInfo.has(c)) g.cellInfo.set(c, new Map());
    const existingCellInfo = g.cellInfo.get(c)!.get(s);
    if (existingCellInfo) {
      const knownIds = new Set(existingCellInfo.recipients.map(r => r.orderItemId));
      existingCellInfo.recipients.push(...info.recipients.filter(r => !knownIds.has(r.orderItemId)));
    } else {
      g.cellInfo.get(c)!.set(s, info);
    }
    if (!g.rowInfo.has(c)) g.rowInfo.set(c, []);
    const existing = g.rowInfo.get(c)!;
    if (!existing.find(r => r.orderNumber === item.orderNumber && r.customerName === item.customerName)) {
      existing.push(info);
    }
  }
  const allSizesSet = new Set<string>();
  for (const gk of groupKeys) for (const s of groups.get(gk)!.sizes) allSizesSet.add(s);
  const allSizes = sortSizes([...allSizesSet]);
  return { groupKeys, groups, allSizes };
}

function POTooltip({ orderNumber, customerName, recipients }: POCellInfo) {
  if (!orderNumber && !customerName && recipients.length === 0) return null;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none min-w-[180px] max-w-[280px]">
      {recipients.length > 0 ? (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Who this is for</div>
          <div className="space-y-1">
            {recipients.map((recipient) => (
              <div key={recipient.orderItemId} className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold whitespace-nowrap">{recipient.recipientName}</div>
                  {recipient.orderNumber && <div className="text-slate-400">{recipient.orderNumber}</div>}
                </div>
                <div className="font-semibold whitespace-nowrap">×{recipient.quantity}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {orderNumber && <div className="font-semibold">{orderNumber}</div>}
          {customerName && <div className="text-slate-300">{customerName}</div>}
        </>
      )}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
    </div>
  );
}

function RowTooltip({ infos }: { infos: POCellInfo[] }) {
  const entries = infos.filter(i => i.orderNumber || i.customerName);
  if (entries.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl pointer-events-none min-w-max whitespace-nowrap">
      {entries.map((e, i) => (
        <div key={i} className={i > 0 ? "mt-1 pt-1 border-t border-slate-600" : ""}>
          {e.orderNumber && <div className="font-semibold">{e.orderNumber}</div>}
          {e.customerName && <div className="text-slate-300">{e.customerName}</div>}
        </div>
      ))}
      <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-800" />
    </div>
  );
}

type ReqOrderEntry = { orderNumber: string | null; customerName: string | null; qty: number };

function buildReqMatrix(items: PurchaseRequirement[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, {
    code: string | null; productName: string; productSku: string | null; price: number | null; colours: string[]; sizes: string[];
    qty: Map<string, Map<string, { total: number; cellKey: string }>>;
    rowItemIds: Map<string, number[]>;
    cellOrders: Map<string, Map<string, ReqOrderEntry[]>>;
    rowOrders: Map<string, ReqOrderEntry[]>;
  }>();
  for (const item of items) {
    const effectiveCode = item.supplierCode ?? item.secondarySupplierCode ?? null;
    const gk = effectiveCode ?? item.canonicalProductName ?? item.productName;
    if (!groups.has(gk)) groupKeys.push(gk);
    if (!groups.has(gk)) groups.set(gk, { code: effectiveCode, productName: item.canonicalProductName ?? item.productName, productSku: item.productSku ?? null, price: item.supplierPrice ?? null, colours: [], sizes: [], qty: new Map(), rowItemIds: new Map(), cellOrders: new Map(), rowOrders: new Map() });
    const g = groups.get(gk)!;
    if (g.price == null && item.supplierPrice != null) g.price = item.supplierPrice;
    const c = item.colour ?? "—"; const s = normalizeSize(item.size ?? "—");
    const cellKey = [item.productName, item.colour ?? "", item.size ?? "", effectiveCode ?? ""].join("|");
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    if (!g.qty.has(c)) g.qty.set(c, new Map());
    const existing = g.qty.get(c)!.get(s);
    g.qty.get(c)!.set(s, { total: (existing?.total ?? 0) + (item.purchaseQuantity ?? 1), cellKey });
    if (!g.rowItemIds.has(c)) g.rowItemIds.set(c, []);
    g.rowItemIds.get(c)!.push(item.itemId);
    // track per-cell order breakdown
    if (!g.cellOrders.has(c)) g.cellOrders.set(c, new Map());
    if (!g.cellOrders.get(c)!.has(s)) g.cellOrders.get(c)!.set(s, []);
    g.cellOrders.get(c)!.get(s)!.push({ orderNumber: item.orderNumber, customerName: item.customerName, qty: item.purchaseQuantity ?? 1 });
    // track per-row order breakdown (deduplicate by orderId)
    if (!g.rowOrders.has(c)) g.rowOrders.set(c, []);
    const rowList = g.rowOrders.get(c)!;
    const existingRow = rowList.find(e => e.orderNumber === item.orderNumber);
    if (existingRow) existingRow.qty += item.purchaseQuantity ?? 1;
    else rowList.push({ orderNumber: item.orderNumber, customerName: item.customerName, qty: item.purchaseQuantity ?? 1 });
  }
  const allSizesSet = new Set<string>();
  for (const gk of groupKeys) for (const s of groups.get(gk)!.sizes) allSizesSet.add(s);
  const allSizes = sortSizes([...allSizesSet]);
  return { groupKeys, groups, allSizes };
}

function ReqCellTooltip({ entries }: { entries: ReqOrderEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl pointer-events-none min-w-max whitespace-nowrap">
      {entries.map((e, i) => (
        <div key={i} className={i > 0 ? "mt-1 pt-1 border-t border-slate-600" : ""}>
          <span className="font-semibold">{e.orderNumber ?? "No order #"}</span>
          {e.customerName && <span className="text-slate-300 ml-1.5">{e.customerName}</span>}
          <span className="ml-2 text-emerald-300 font-bold">×{e.qty}</span>
        </div>
      ))}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
    </div>
  );
}

function ReqRowTooltip({ entries }: { entries: ReqOrderEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl pointer-events-none min-w-max whitespace-nowrap">
      {entries.map((e, i) => (
        <div key={i} className={i > 0 ? "mt-1 pt-1 border-t border-slate-600" : ""}>
          <span className="font-semibold">{e.orderNumber ?? "No order #"}</span>
          {e.customerName && <span className="text-slate-300 ml-1.5">{e.customerName}</span>}
          <span className="ml-2 text-emerald-300 font-bold">×{e.qty}</span>
        </div>
      ))}
      <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-800" />
    </div>
  );
}

function ReqMatrixView({ items, overrides, onQtyChange, onDeleteRow, currency }: {
  items: PurchaseRequirement[];
  overrides: Record<string, number>;
  onQtyChange: (cellKey: string, qty: number) => void;
  onDeleteRow: (itemIds: number[]) => void;
  currency?: string;
}) {
  const { groupKeys, groups, allSizes } = buildReqMatrix(items);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const sym = currencySymbol(currency);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-800 text-white">
            <TableHead className="font-semibold text-white w-24">Code</TableHead>
            <TableHead className="font-semibold text-white">Colour</TableHead>
            {allSizes.map((s) => <TableHead key={s} className="text-center font-semibold text-white">{s}</TableHead>)}
            <TableHead className="text-center font-semibold text-white">Total</TableHead>
            <TableHead className="text-right font-semibold text-white whitespace-nowrap">Unit Price</TableHead>
            <TableHead className="text-right font-semibold text-white whitespace-nowrap">Line Total</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupKeys.map((gk) => {
            const g = groups.get(gk)!;
            return g.colours.map((colour, ci) => {
              const rowItemIds = g.rowItemIds.get(colour) ?? [];
              const rowOrders = g.rowOrders.get(colour) ?? [];
              const rowKey = `${gk}||${colour}`;
              const rowTotal = allSizes.reduce((s, sz) => {
                const cell = g.qty.get(colour)?.get(sz);
                return s + (cell ? (overrides[cell.cellKey] ?? cell.total) : 0);
              }, 0);
              const lineTotal = g.price != null ? g.price * rowTotal : null;
              return (
                <TableRow key={`${gk}-${colour}`} className={ci % 2 === 0 ? "bg-white" : "bg-muted/30"}>
                  <TableCell className="font-mono font-bold text-xs text-indigo-700 min-w-[110px]">
                    <div>{g.code ?? "—"}</div>
                    {ci === 0 && (
                      <div className="text-xs font-normal text-muted-foreground font-sans break-words">{g.productName}</div>
                    )}
                    {ci === 0 && g.productSku && (
                      <div className="text-xs font-mono text-indigo-400">{g.productSku}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    <div
                      className="relative inline-block cursor-default"
                      onMouseEnter={() => setHoveredRow(rowKey)}
                      onMouseLeave={() => setHoveredRow(null)}
                    >
                      {colour}
                      {hoveredRow === rowKey && <ReqRowTooltip entries={rowOrders} />}
                    </div>
                  </TableCell>
                  {allSizes.map((sz) => {
                    const cell = g.qty.get(colour)?.get(sz);
                    const cellOrders = g.cellOrders.get(colour)?.get(sz) ?? [];
                    const cellKey = `${gk}||${colour}||${sz}`;
                    if (!cell) return <TableCell key={sz} className="text-center p-1"><span className="text-muted-foreground text-xs">—</span></TableCell>;
                    const val = overrides[cell.cellKey] ?? cell.total;
                    return (
                      <TableCell key={sz} className="text-center p-1">
                        <div
                          className="relative inline-block"
                          onMouseEnter={() => setHoveredCell(cellKey)}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          <Input
                            type="number" min={0} value={val}
                            onChange={(e) => onQtyChange(cell.cellKey, Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-14 h-7 text-center text-sm px-1 font-semibold text-primary"
                          />
                          {hoveredCell === cellKey && <ReqCellTooltip entries={cellOrders} />}
                        </div>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center font-bold text-sm">{rowTotal}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                    {g.price != null ? `${sym}${parseFloat(String(g.price)).toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold whitespace-nowrap">
                    {lineTotal != null ? `${sym}${lineTotal.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-center p-1">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDeleteRow(rowItemIds)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            });
          })}
          {groupKeys.length > 0 && (() => {
            const grandTotalQty = groupKeys.reduce((sum, gk) => {
              const g = groups.get(gk)!;
              return sum + g.colours.reduce((cs, c) => cs + allSizes.reduce((s, sz) => {
                const cell = g.qty.get(c)?.get(sz);
                return s + (cell ? (overrides[cell.cellKey] ?? cell.total) : 0);
              }, 0), 0);
            }, 0);
            const grandTotalValue = groupKeys.reduce((sum, gk) => {
              const g = groups.get(gk)!;
              if (g.price == null) return sum;
              const qty = g.colours.reduce((cs, c) => cs + allSizes.reduce((s, sz) => {
                const cell = g.qty.get(c)?.get(sz);
                return s + (cell ? (overrides[cell.cellKey] ?? cell.total) : 0);
              }, 0), 0);
              return sum + g.price * qty;
            }, 0);
            const hasAnyPrice = groupKeys.some(gk => groups.get(gk)!.price != null);
            return (
              <TableRow className="bg-slate-800">
                <TableCell className="text-white font-bold text-sm" colSpan={2}>TOTAL</TableCell>
                {allSizes.map((sz) => {
                  const t = groupKeys.reduce((sum, gk) => {
                    const g = groups.get(gk)!;
                    return sum + g.colours.reduce((s, c) => {
                      const cell = g.qty.get(c)?.get(sz);
                      return s + (cell ? (overrides[cell.cellKey] ?? cell.total) : 0);
                    }, 0);
                  }, 0);
                  return <TableCell key={sz} className="text-center font-bold text-white">{t > 0 ? t : "—"}</TableCell>;
                })}
                <TableCell className="text-center font-bold text-white">{grandTotalQty}</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold text-white whitespace-nowrap">
                  {hasAnyPrice ? `${sym}${grandTotalValue.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell />
              </TableRow>
            );
          })()}
        </TableBody>
      </Table>
    </div>
  );
}

function MatrixQtyInput({ itemId, initialQty, onSave }: { itemId: number; initialQty: number; onSave: (itemId: number, qty: number) => void }) {
  const [val, setVal] = useState(String(initialQty));
  const valRef = useRef(val);
  valRef.current = val;

  useEffect(() => { setVal(String(initialQty)); }, [initialQty]);

  const handleBlur = () => {
    const parsed = parseInt(valRef.current);
    if (!isNaN(parsed) && parsed >= 1 && parsed !== initialQty) {
      onSave(itemId, parsed);
    }
  };

  return (
    <input
      type="number" min={1} value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      className="w-14 h-7 text-center text-sm font-semibold text-primary border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring px-1"
    />
  );
}

function POMatrixView({ items, currency, onDeleteLine, onLineUpdate, onDueDateChange }: {
  items: POItem[];
  currency?: string;
  onDeleteLine?: (itemId: number) => void;
  onLineUpdate?: (itemId: number, qty: number) => void;
  onDueDateChange?: (itemIds: number[], date: string | null) => void;
}) {
  const { groupKeys, groups, allSizes } = buildPOMatrix(items);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // Per-row due dates: rowKey -> YYYY-MM-DD string
  const [rowDueDates, setRowDueDates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [gk, g] of groups.entries()) {
      for (const colour of g.colours) {
        const rowIds = g.rowItemIds.get(colour) ?? [];
        const dated = items.find(i => rowIds.includes(i.id) && i.estimatedDueDate != null);
        if (dated) init[`${gk}||${colour}`] = toDateInputValue(dated.estimatedDueDate);
      }
    }
    return init;
  });

  const handleRowDueDateChange = (rowKey: string, rowIds: number[], date: string) => {
    setRowDueDates(prev => ({ ...prev, [rowKey]: date }));
    onDueDateChange?.(rowIds, date || null);
  };

  const handleRowDueDateClear = (rowKey: string, rowIds: number[]) => {
    setRowDueDates(prev => { const next = { ...prev }; delete next[rowKey]; return next; });
    onDueDateChange?.(rowIds, null);
  };

  const showDueDateCol = !!onDueDateChange;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-800 text-white">
            <TableHead className="font-semibold text-white">Code</TableHead>
            <TableHead className="font-semibold text-white">Colour</TableHead>
            {allSizes.map((s) => <TableHead key={s} className="text-center font-semibold text-white">{s}</TableHead>)}
            <TableHead className="text-center font-semibold text-white">Total</TableHead>
            {showDueDateCol && <TableHead className="font-semibold text-white text-xs whitespace-nowrap w-24">Due</TableHead>}
            {onDeleteLine && <TableHead className="w-6 min-w-[1.5rem]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupKeys.map((gk) => {
            const g = groups.get(gk)!;
            return (
              <>
                {g.colours.map((colour, ci) => {
                  const rowTotal = allSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
                  const rowIds = g.rowItemIds.get(colour) ?? [];
                  const rowInfos = g.rowInfo.get(colour) ?? [];
                  const rowKey = `${gk}||${colour}`;
                  const rowDueDate = rowDueDates[rowKey] ?? "";
                  return (
                    <TableRow key={`${gk}-${colour}`} className={ci % 2 === 0 ? "bg-white" : "bg-muted/30"}>
                      {ci === 0 ? (
                        <TableCell className="font-mono font-bold text-sm text-indigo-700 align-top pt-3">
                          <div>{g.code ?? "—"}</div>
                          <div className="text-xs font-normal text-muted-foreground font-sans truncate max-w-[90px]">{g.productName}</div>
                          {g.price != null && <div className="text-xs text-muted-foreground">{currencySymbol(currency)}{parseFloat(String(g.price)).toFixed(2)}/u</div>}
                        </TableCell>
                      ) : (
                        <TableCell />
                      )}
                      <TableCell className="font-medium">
                        <div
                          className="relative inline-block cursor-default"
                          onMouseEnter={() => setHoveredRow(rowKey)}
                          onMouseLeave={() => setHoveredRow(null)}
                        >
                          {colour}
                          {hoveredRow === rowKey && <RowTooltip infos={rowInfos} />}
                        </div>
                      </TableCell>
                      {allSizes.map((sz) => {
                        const qty = g.qty.get(colour)?.get(sz) ?? 0;
                        const cellItemId = g.cellItemId.get(colour)?.get(sz);
                        const cellKey = `${gk}||${colour}||${sz}`;
                        const cellInfo = g.cellInfo.get(colour)?.get(sz);
                        if (onLineUpdate && cellItemId && qty > 0) {
                          return (
                            <TableCell key={sz} className="text-center p-1">
                              <div
                                className="relative inline-block"
                                onMouseEnter={() => setHoveredCell(cellKey)}
                                onMouseLeave={() => setHoveredCell(null)}
                              >
                                <MatrixQtyInput itemId={cellItemId} initialQty={qty} onSave={onLineUpdate} />
                                {hoveredCell === cellKey && cellInfo && <POTooltip {...cellInfo} />}
                              </div>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={sz} className="text-center">
                            {qty > 0 ? (
                              <div
                                className="relative inline-block cursor-default"
                                onMouseEnter={() => setHoveredCell(cellKey)}
                                onMouseLeave={() => setHoveredCell(null)}
                              >
                                <span className="font-semibold text-primary">{qty}</span>
                                {hoveredCell === cellKey && cellInfo && <POTooltip {...cellInfo} />}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-bold">{rowTotal}</TableCell>
                      {showDueDateCol && (
                        <TableCell className="p-1 w-24">
                          <div className="flex items-center gap-0.5">
                            <input
                              type="date"
                              value={rowDueDate}
                              onChange={e => handleRowDueDateChange(rowKey, rowIds, e.target.value)}
                              className="h-6 w-20 text-[10px] rounded border border-input bg-background px-1 focus:outline-none focus:ring-1 focus:ring-primary"
                              title="Set backorder due date for this row"
                            />
                            {rowDueDate && (
                              <button
                                type="button"
                                onClick={() => handleRowDueDateClear(rowKey, rowIds)}
                                className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                                title="Clear due date"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                          {rowDueDate && (
                            <span className="inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-px">
                              <CalendarDays className="w-2 h-2" /> Backorder
                            </span>
                          )}
                        </TableCell>
                      )}
                      {onDeleteLine && (
                        <TableCell className="text-center p-1">
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${colour} row (${rowTotal} units) from the PO?`))
                                rowIds.forEach(id => onDeleteLine(id));
                            }}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Remove this colour row from PO">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </>
            );
          })}
          {groupKeys.length > 1 && (
            <TableRow className="bg-slate-800">
              <TableCell className="text-white font-bold text-sm" colSpan={2}>TOTAL</TableCell>
              {allSizes.map((sz) => {
                const t = groupKeys.reduce((sum, gk) => { const g = groups.get(gk)!; return sum + g.colours.reduce((s, c) => s + (g.qty.get(c)?.get(sz) ?? 0), 0); }, 0);
                return <TableCell key={sz} className="text-center font-bold text-white">{t > 0 ? t : "—"}</TableCell>;
              })}
              <TableCell className="text-center font-bold text-white">{items.reduce((s, i) => s + i.quantityOrdered, 0)}</TableCell>
              {showDueDateCol && <TableCell />}
              {onDeleteLine && <TableCell />}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function buildPOMailtoBody(po: PurchaseOrder, notes: string): string {
  const { groupKeys, groups, allSizes } = buildPOMatrix(po.items);
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const lines: string[] = [
    `Dear ${po.supplierName},`,
    ``,
    `Please supply the following items for purchase order ${po.poNumber} dated ${dateStr}:`,
    ``,
  ];
  for (const gk of groupKeys) {
    const g = groups.get(gk)!;
    lines.push(`${g.productName}${g.code ? ` [${g.code}]` : ""}:`);
    for (const colour of g.colours) {
      const parts = allSizes
        .map((sz) => { const q = g.qty.get(colour)?.get(sz) ?? 0; return q > 0 ? `${sz}: ${q}` : null; })
        .filter(Boolean);
      lines.push(`  ${colour} — ${parts.join(", ")}`);
    }
    lines.push(``);
  }
  const totalUnits = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  lines.push(`Total units: ${totalUnits}`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``, `Please see the attached PDF for full details.`, ``, `Kind regards,`, `Your business`);
  return lines.join("\n");
}

function POEmailDialog({ po, open, onClose, onSent, onFileUploaded }: {
  po: PurchaseOrder; open: boolean; onClose: () => void; onSent: () => void; onFileUploaded?: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [manualEmail, setManualEmail] = useState(po.supplierEmail ?? "");
  const [estimatedDueDate, setEstimatedDueDate] = useState("");
  const [sending, setSending] = useState(false);
  const [markingOrdered, setMarkingOrdered] = useState(false);
  const [previewingPdf, setPreviewingPdf] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [localFileUrls, setLocalFileUrls] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPsIdRef = useRef<number | null>(null);

  const { uploadFile } = useUpload({
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const processStockItems = po.items.filter((i) => i.processStockId != null);
  const missingFiles = processStockItems.filter(
    (i) => !localFileUrls[i.processStockId!] && !i.processStockFileUrl
  );

  const handleRowClick = (psId: number) => {
    pendingPsIdRef.current = psId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const psId = pendingPsIdRef.current;
    e.target.value = "";
    if (!file || !psId) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "eps" && ext !== "pdf") {
      toast({ title: "Invalid file type", description: "Please upload an EPS or PDF file.", variant: "destructive" });
      return;
    }

    setUploadingId(psId);
    try {
      const result = await uploadFile(file);
      await apiFetch(`/process-stock/${psId}`, {
        method: "PATCH",
        body: JSON.stringify({ fileUrl: result.objectPath }),
      });
      setLocalFileUrls((s) => ({ ...s, [psId]: result.objectPath }));
      toast({ title: "File attached", description: `${file.name} uploaded successfully.` });
      onFileUploaded?.();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingId(null);
      pendingPsIdRef.current = null;
    }
  };

  const effectiveEmail = manualEmail.trim();

  useEffect(() => { setManualEmail(po.supplierEmail ?? ""); }, [po.id, po.supplierEmail]);

  const handleSend = async () => {
    setSending(true);
    try {
      const recipient = manualEmail.trim();
      await apiFetch(`/purchasing/purchase-orders/${po.id}/send-email`, {
        method: "POST",
        body: JSON.stringify({
          notes,
          overrideEmail: manualEmail.trim() || undefined,
          estimatedDueDate: estimatedDueDate || undefined,
        }),
      });
      toast({ title: "Email sent", description: `PO sent to ${recipient}` });
      onSent();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleMarkOrdered = async () => {
    setMarkingOrdered(true);
    try {
      await apiFetch(`/purchasing/purchase-orders/${po.id}/mark-ordered`, {
        method: "POST",
        body: JSON.stringify({ estimatedDueDate: estimatedDueDate || undefined }),
      });
      toast({ title: "Marked as ordered", description: "PO status updated without sending an email." });
      onSent();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setMarkingOrdered(false);
    }
  };

  const handlePreviewPdf = async () => {
    setPreviewingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/purchasing/purchase-orders/${po.id}/pdf`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      } else {
        URL.revokeObjectURL(url);
        toast({ title: "Popup blocked", description: "Please allow popups for this site and try again.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not load PDF", description: e.message, variant: "destructive" });
    } finally {
      setPreviewingPdf(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* Hidden file input shared across all rows */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".eps,.pdf,application/postscript,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      <DialogContent className="max-w-md flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />Send PO — {po.poNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Recipient email
            </Label>
            <Input
              type="email"
              placeholder="supplier@example.com"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              className="text-sm"
            />
            {!po.supplierEmail && (
              <p className="text-xs text-amber-700">No email on file — enter one above or use "Mark as Ordered" instead.</p>
            )}
          </div>

          {processStockItems.length > 0 && (
            <div className="space-y-1.5 min-h-0">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Print files to attach</div>
                <div className="text-xs text-muted-foreground">
                  {processStockItems.length - missingFiles.length}/{processStockItems.length} ready
                </div>
              </div>
              <div className="rounded-lg border border-border divide-y text-sm overflow-y-auto max-h-52">
                {processStockItems.map((i) => {
                  const hasFile = !!(localFileUrls[i.processStockId!] ?? i.processStockFileUrl);
                  const isUploading = uploadingId === i.processStockId;
                  return (
                    <div
                      key={i.id}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 transition-colors",
                        !hasFile && !isUploading
                          ? "cursor-pointer hover:bg-amber-50 group"
                          : ""
                      )}
                      onClick={() => !hasFile && !isUploading && i.processStockId && handleRowClick(i.processStockId)}
                      title={!hasFile ? "Click to upload print file (EPS or PDF)" : undefined}
                    >
                      {isUploading ? (
                        <Loader2 className="w-3.5 h-3.5 text-primary shrink-0 animate-spin" />
                      ) : hasFile ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : (
                        <TriangleAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-mono text-xs font-semibold text-indigo-700 shrink-0">{i.supplierCode ?? "—"}</span>
                      <span className="truncate flex-1">{i.productName}</span>
                      {isUploading && (
                        <span className="ml-auto text-xs text-primary whitespace-nowrap">Uploading…</span>
                      )}
                      {!hasFile && !isUploading && (
                        <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 whitespace-nowrap group-hover:text-primary transition-colors">
                          <Upload className="w-3 h-3" /> Upload
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {missingFiles.length > 0 && (
                <p className="text-xs text-amber-700">
                  {missingFiles.length} item{missingFiles.length !== 1 ? "s" : ""} without a print file — click a row above to upload.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Additional notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra instructions for this supplier..." rows={2} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" /> Estimated delivery date (optional)
              </Label>
              <Input
                type="date"
                value={estimatedDueDate}
                onChange={(e) => setEstimatedDueDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 shrink-0 flex-wrap">
          <Button variant="outline" className="gap-2 mr-auto" onClick={handlePreviewPdf} disabled={previewingPdf}>
            {previewingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {previewingPdf ? "Loading…" : "Preview PDF"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline"
            onClick={handleMarkOrdered}
            disabled={markingOrdered || sending}
            className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            {markingOrdered ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><PackageCheck className="w-4 h-4" />Mark as Ordered</>}
          </Button>
          <Button onClick={handleSend} disabled={sending || markingOrdered || (!po.supplierEmail && !manualEmail.trim())} className="gap-2">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</> : <><Send className="w-4 h-4" />Send Email</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildEmailBody(group: SupplierGroup, notes: string): string {
  const productMap = new Map<string, Map<string, number>>();
  for (const item of group.items) {
    const key = item.productName;
    if (!productMap.has(key)) productMap.set(key, new Map());
    const sizeKey = [item.colour, item.size].filter(Boolean).join(" / ") || "N/A";
    const existing = productMap.get(key)!.get(sizeKey) ?? 0;
    productMap.get(key)!.set(sizeKey, existing + (item.purchaseQuantity ?? 0));
  }
  const lines: string[] = [];
  lines.push(`Dear ${group.supplierName},`, ``, `Please supply the following items:`, ``);
  for (const [product, sizes] of productMap.entries()) {
    lines.push(`${product}:`);
    for (const [size, qty] of sizes.entries()) lines.push(`  ${size}: ${qty}`);
    lines.push(``);
  }
  const orders = [...new Set(group.items.map((i) => i.orderNumber).filter(Boolean))];
  lines.push(`These are required for orders: ${orders.join(", ")}`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``, `Kind regards,`, `Your business`);
  return lines.join("\n");
}

function productDisplayName(item: PurchaseRequirement): string {
  return item.canonicalProductName ?? item.productName;
}

function poItemDisplayName(item: POItem): string {
  return item.processStockId != null
    ? item.productName
    : (item.canonicalProductName ?? item.productName);
}

function productLabel(item: PurchaseRequirement): string {
  const name = productDisplayName(item);
  const code = item.supplierCode ?? item.secondarySupplierCode ?? item.productSku;
  return code ? `${code} — ${name}` : name;
}

/** Single editable row in the requirements table */
function RequirementsRow({
  item,
  onQtyChange,
}: {
  item: PurchaseRequirement;
  onQtyChange: (item: PurchaseRequirement, qty: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const baseQty = item.purchaseQuantity ?? 1;

  const commit = (value: number) => {
    if (value >= 1 && value !== baseQty) onQtyChange(item, value);
  };

  const changeBy = (delta: number) => {
    if (!inputRef.current) return;
    const next = Math.max(1, (parseInt(inputRef.current.value) || baseQty) + delta);
    inputRef.current.value = String(next);
    commit(next);
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-sm">{item.canonicalProductName ?? item.productName}</div>
        {(item.supplierCode || item.secondarySupplierCode || item.productSku) && (
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {item.supplierCode && <span className="mr-2">Supplier: {item.supplierCode}</span>}
            {!item.supplierCode && item.secondarySupplierCode && <span className="mr-2">Code: {item.secondarySupplierCode}</span>}
            {item.productSku && <span>SKU: {item.productSku}</span>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
      </TableCell>
      <TableCell className="text-xs font-mono text-muted-foreground">
        {item.orderNumber ?? "—"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            className="w-6 h-6 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-base leading-none"
            onClick={() => changeBy(-1)}
          >−</button>
          <input
            ref={inputRef}
            type="number"
            min={1}
            defaultValue={baseQty}
            key={baseQty}
            className="w-12 text-center text-sm font-semibold border border-transparent hover:border-input focus:border-input rounded px-1 py-0.5 bg-transparent focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            onBlur={(e) => commit(parseInt(e.target.value) || baseQty)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <button
            type="button"
            className="w-6 h-6 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-base leading-none"
            onClick={() => changeBy(1)}
          >+</button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Grouped table — one row per unique SKU (product+colour+size), orders combined */
function RequirementsLineTable({ items }: { items: PurchaseRequirement[] }) {
  // Group by SKU key so the table matches what the resulting PO will look like
  const groupKeys: string[] = [];
  const groups = new Map<string, PurchaseRequirement[]>();
  for (const item of items) {
    const ec = item.supplierCode ?? item.secondarySupplierCode ?? "";
    const key = [item.productName, item.colour ?? "", item.size ?? "", ec].join("|");
    if (!groups.has(key)) { groupKeys.push(key); groups.set(key, []); }
    groups.get(key)!.push(item);
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Product</TableHead>
            <TableHead className="font-semibold min-w-[130px]">Colour / Size</TableHead>
            <TableHead className="font-semibold text-xs min-w-[120px]">Orders</TableHead>
            <TableHead className="text-center font-semibold min-w-[80px]">Qty</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupKeys.map((key) => {
            const groupItems = groups.get(key)!;
            const first = groupItems[0];
            const totalQty = groupItems.reduce((s, i) => s + (i.purchaseQuantity ?? 1), 0);
            const orderNums = [...new Set(groupItems.map((i) => i.orderNumber).filter(Boolean))];
            return (
              <TableRow key={key}>
                <TableCell>
                  <div className="font-medium text-sm">{first.canonicalProductName ?? first.productName}</div>
                  {(first.supplierCode || first.secondarySupplierCode || first.productSku) && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {first.supplierCode && <span className="mr-2">Supplier: {first.supplierCode}</span>}
                      {!first.supplierCode && first.secondarySupplierCode && <span className="mr-2">Code: {first.secondarySupplierCode}</span>}
                      {first.productSku && <span>SKU: {first.productSku}</span>}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {[first.colour, first.size].filter(Boolean).join(" / ") || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {orderNums.map((on) => (
                      <span key={on} className="text-xs font-mono font-semibold text-primary bg-primary/8 rounded px-1 py-0.5">{on}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center font-bold text-sm">{totalQty}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ProcessMaterialsLineTable({
  items,
  overrides,
  onQtyChange,
  onRemove,
  showBookIn = true,
}: {
  items: ProcessStockRequirement[];
  overrides?: Record<number, number>;
  onQtyChange?: (processStockId: number, qty: number) => void;
  onRemove?: (processStockId: number) => void;
  showBookIn?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [bookingInId, setBookingInId] = useState<number | null>(null);
  const [bookInQty, setBookInQty] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);

  async function confirmBookIn(psId: number) {
    const qty = parseInt(bookInQty, 10);
    if (isNaN(qty) || qty <= 0) return;
    setBookingInProgress(true);
    try {
      await apiFetch(`/process-stock/${psId}/book-in`, {
        method: "POST",
        body: JSON.stringify({ quantity: qty }),
      });
      await qc.invalidateQueries({ queryKey: ["process-stock-requirements"] });
      toast({ title: "Stock booked in", description: `Added ${qty} units to stock.` });
      setBookingInId(null);
      setBookInQty("");
    } catch {
      toast({ title: "Failed to book in stock", variant: "destructive" });
    } finally {
      setBookingInProgress(false);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Material</TableHead>
            <TableHead className="font-semibold min-w-[110px]">SKU</TableHead>
            <TableHead className="font-semibold text-xs min-w-[140px]">Orders</TableHead>
            <TableHead className="text-center font-semibold min-w-[110px]">Qty to order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((req) => {
            const qty = overrides?.[req.processStockId] ?? req.shortfall;
            const isBookingThis = bookingInId === req.processStockId;
            return (
              <TableRow key={req.processStockId}>
                <TableCell>
                  <div className="font-medium text-sm">{req.name}</div>
                  <div className="text-xs text-muted-foreground">In stock: {req.stockQuantity} · Need: {req.totalNeeded}</div>
                  {showBookIn && (isBookingThis ? (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <input
                        autoFocus
                        type="number"
                        min={1}
                        value={bookInQty}
                        onChange={e => setBookInQty(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") confirmBookIn(req.processStockId);
                          if (e.key === "Escape") { setBookingInId(null); setBookInQty(""); }
                        }}
                        placeholder="Qty received"
                        className="w-24 border border-border rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <Button size="sm" variant="default" className="h-6 text-xs px-2 gap-1"
                        disabled={bookingInProgress || !bookInQty}
                        onClick={() => confirmBookIn(req.processStockId)}>
                        {bookingInProgress ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-1"
                        onClick={() => { setBookingInId(null); setBookInQty(""); }}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="mt-1 flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                      onClick={() => { setBookingInId(req.processStockId); setBookInQty(String(req.shortfall)); }}
                    >
                      <PackagePlus className="w-3 h-3" /> Book in received stock
                    </button>
                  ))}
                </TableCell>
                <TableCell>
                  {req.sku
                    ? <span className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0">{req.sku}</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    {req.orders.map((o) => (
                      <span key={o.orderId} className="text-xs">
                        <a href={`/orders/${o.orderId}`} className="text-primary hover:underline font-mono font-semibold" title={o.customerName ?? undefined}>{o.orderNumber}</a>
                        {` ×${o.qty}`}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    {onQtyChange ? (
                      <input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 0) onQtyChange(req.processStockId, v);
                        }}
                        className="w-20 text-center border border-border rounded px-2 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                      />
                    ) : (
                      <span className="font-bold text-sm">{qty}</span>
                    )}
                    {onRemove && (
                      <button
                        onClick={() => onRemove(req.processStockId)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove from order"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function EmailDialog({ group, open, onClose, onSent }: { group: SupplierGroup; open: boolean; onClose: () => void; onSent: (ids: number[]) => void }) {
  const [notes, setNotes] = useState("");
  const emailBody = buildEmailBody(group, notes);
  const subject = encodeURIComponent(`Purchase Order`);
  const mailto = `mailto:${group.supplierEmail ?? ""}?subject=${subject}&body=${encodeURIComponent(emailBody)}`;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" />Purchase Order — {group.supplierName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Additional Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes for this supplier..." rows={2} /></div>
          <div className="space-y-1"><Label>Email Preview</Label><pre className="text-xs bg-muted/50 border border-border rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">{emailBody}</pre></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { window.open(mailto, "_blank"); onSent(group.items.map((i) => i.itemId)); }} className="gap-2"><Mail className="w-4 h-4" />Open Email Client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.split("T")[0];
}

function DeliveryRow({ line, onSave }: {
  line: POItem;
  onSave: (itemId: number, data: { quantityDelivered?: number; quantityOrdered?: number; estimatedDueDate?: string | null }) => void;
}) {
  const [qtyDel, setQtyDel] = useState(String(line.quantityDelivered));
  const [qtyOrd, setQtyOrd] = useState(String(line.quantityOrdered));
  const [dueDate, setDueDate] = useState(toDateInputValue(line.estimatedDueDate));
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const qtyRef = useRef(qtyDel);
  const qtyOrdRef = useRef(qtyOrd);
  const dateRef = useRef(dueDate);
  qtyRef.current = qtyDel;
  qtyOrdRef.current = qtyOrd;
  dateRef.current = dueDate;

  useEffect(() => { setQtyOrd(String(line.quantityOrdered)); }, [line.quantityOrdered]);

  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const parsed = parseInt(qtyRef.current);
      const parsedOrd = parseInt(qtyOrdRef.current);
      onSave(line.id, {
        quantityDelivered: isNaN(parsed) ? 0 : Math.max(0, parsed),
        quantityOrdered: isNaN(parsedOrd) ? line.quantityOrdered : Math.max(1, parsedOrd),
        estimatedDueDate: dateRef.current || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 120);
  }, [line.id, line.quantityOrdered, onSave]);

  const ordQty = parseInt(qtyOrd) || line.quantityOrdered;
  const qty = parseInt(qtyDel) || 0;
  const fullyDelivered = qty >= ordQty;
  const overDelivered = qty > ordQty;
  const remaining = ordQty - qty;
  const surplus = qty - ordQty;

  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${
      overDelivered ? "border-orange-200 bg-orange-50/40" :
      fullyDelivered ? "border-green-200 bg-green-50/50" :
      "border-border bg-card"
    }`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {line.supplierCode && (
              <span className="font-bold text-sm font-mono text-primary">{line.supplierCode}</span>
            )}
            {line.productSku && (
              <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{line.productSku}</span>
            )}
            <span className="font-medium text-sm">{poItemDisplayName(line)}</span>
          </div>
          {(line.colour || line.size) && (
            <div className="text-muted-foreground text-xs mt-0.5">{[line.colour, line.size].filter(Boolean).join(" / ")}</div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Ordered qty — editable */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Ord:</span>
            <Input
              type="number" min={1} value={qtyOrd}
              onChange={(e) => setQtyOrd(e.target.value)}
              onBlur={triggerSave}
              className="h-7 w-14 text-sm text-center px-1"
              title="Order quantity"
            />
          </div>
          {/* Received qty — no max cap, allows over-delivery */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Rcvd:</span>
            <Input
              type="number" min={0} value={qtyDel}
              onChange={(e) => setQtyDel(e.target.value)}
              onBlur={triggerSave}
              className={`h-7 w-14 text-sm text-center px-1 ${overDelivered ? "border-orange-400 text-orange-700" : ""}`}
            />
          </div>
          {/* Backorder due date — always visible so users can set it */}
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <Input
              type="date" value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={triggerSave}
              className="h-7 w-32 text-xs px-1.5"
              title="Backorder expected delivery date"
            />
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setDueDate(today);
                setTimeout(triggerSave, 0);
              }}
              className="h-7 px-1.5 text-xs rounded border border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Set to today"
            >
              Today
            </button>
          </div>
          {/* Status indicator */}
          {overDelivered ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-100 border border-orange-300 rounded px-1.5 py-0.5">
              <TrendingUp className="w-3 h-3" />+{surplus} to stock
            </span>
          ) : saved ? (
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : fullyDelivered ? (
            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
          ) : remaining > 0 && qty > 0 ? (
            <span className="text-xs text-amber-600 font-medium">{remaining} on backorder</span>
          ) : dueDate ? (
            <span className="text-xs text-blue-600 font-medium">backorder set</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}


function BookInMatrix({ items, poId, onSave, onQtysChange, onCancelLine, onDeleteLine }: {
  items: POItem[];
  poId: number;
  onSave: (poId: number, itemId: number, data: { quantityDelivered?: number; notes?: string | null }) => void;
  onQtysChange?: (qtys: Map<number, number>) => void;
  onCancelLine?: (poId: number, itemId: number, context: string) => void;
  onDeleteLine?: (poId: number, itemId: number) => void;
}) {
  const { groupKeys, groups, allSizes } = useMemo(() => buildPOMatrix(items), [items]);

  const [localQtys, setLocalQtys] = useState<Map<number, number>>(() => {
    const m = new Map<number, number>();
    items.forEach(i => m.set(i.id, i.quantityDelivered ?? 0));
    return m;
  });
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set());
  const [fadingRows, setFadingRows] = useState<Set<string>>(new Set());
  const scheduledRows = useRef<Set<string>>(new Set());
  const saveTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [noteDialog, setNoteDialog] = useState<{ itemId: number; context: string; current: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState<{ itemId: number; context: string } | null>(null);
  const [mismatchConfirm, setMismatchConfirm] = useState<{ itemId: number; entered: number; expected: number; context: string } | null>(null);
  const [focusedCell, setFocusedCell] = useState<string | null>(null); // "{gk}||{colour}||{sz}"

  // Sync upward values when items change (e.g. after "Receive All")
  useEffect(() => {
    setLocalQtys(prev => {
      const next = new Map(prev);
      items.forEach(i => {
        const cur = next.get(i.id) ?? 0;
        if (i.quantityDelivered > cur) next.set(i.id, i.quantityDelivered);
      });
      return next;
    });
  }, [items]);

  const handleQtyChange = useCallback((itemId: number, value: number) => {
    setLocalQtys(prev => {
      const next = new Map(prev).set(itemId, value);
      onQtysChange?.(next);
      return next;
    });
    const existing = saveTimers.current.get(itemId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      onSave(poId, itemId, { quantityDelivered: value });
      saveTimers.current.delete(itemId);
    }, 400);
    saveTimers.current.set(itemId, t);
  }, [poId, onSave, onQtysChange]);

  // Detect completed rows and fade them out
  useEffect(() => {
    for (const gk of groupKeys) {
      const g = groups.get(gk)!;
      for (const colour of g.colours) {
        const rowKey = `${gk}||${colour}`;
        if (scheduledRows.current.has(rowKey)) continue;
        let complete = true;
        let hasAny = false;
        for (const sz of allSizes) {
          const cellItemId = g.cellItemId.get(colour)?.get(sz);
          if (!cellItemId) continue;
          const ordQty = g.qty.get(colour)?.get(sz) ?? 0;
          if (ordQty === 0) continue;
          hasAny = true;
          if ((localQtys.get(cellItemId) ?? 0) < ordQty) { complete = false; break; }
        }
        if (complete && hasAny) {
          scheduledRows.current.add(rowKey);
          setFadingRows(prev => new Set([...prev, rowKey]));
          setTimeout(() => {
            setHiddenRows(prev => new Set([...prev, rowKey]));
            setFadingRows(prev => { const n = new Set(prev); n.delete(rowKey); return n; });
          }, 700);
        }
      }
    }
  }, [localQtys, groupKeys, groups, allSizes]);

  const totalOrdered = items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalReceived = [...localQtys.entries()].reduce((s, [id, qty]) => {
    const item = items.find(i => i.id === id);
    return s + (item ? Math.min(qty, item.quantityOrdered) : 0);
  }, 0);
  const totalRowCount = groupKeys.reduce((count, gk) => count + groups.get(gk)!.colours.length, 0);
  const completedRowCount = hiddenRows.size + fadingRows.size;
  const allDone = totalRowCount > 0 && completedRowCount >= totalRowCount;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: totalOrdered > 0 ? `${Math.min(100, Math.round((totalReceived / totalOrdered) * 100))}%` : "0%" }}
          />
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">{totalReceived}/{totalOrdered} units</span>
      </div>

      {allDone ? (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          All lines fully received — click <strong className="mx-1">Complete Delivery</strong> above to allocate stock to orders.
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto rounded-lg border border-border max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-slate-800 text-white">
                <TableHead className="font-semibold text-white bg-slate-800">Code</TableHead>
                <TableHead className="font-semibold text-white bg-slate-800">Colour</TableHead>
                {allSizes.map(s => (
                  <TableHead key={s} className="text-center font-semibold text-white px-2 py-2.5 bg-slate-800">{s}</TableHead>
                ))}
                <TableHead className="text-center font-semibold text-white bg-slate-800">Rcvd/Ord</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupKeys.map(gk => {
                const g = groups.get(gk)!;
                return g.colours.map((colour, ci) => {
                  const rowKey = `${gk}||${colour}`;
                  if (hiddenRows.has(rowKey)) return null;
                  const isFading = fadingRows.has(rowKey);
                  const rowOrdered = allSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
                  const rowReceived = allSizes.reduce((s, sz) => {
                    const id = g.cellItemId.get(colour)?.get(sz);
                    return s + (id ? Math.min(localQtys.get(id) ?? 0, g.qty.get(colour)?.get(sz) ?? 0) : 0);
                  }, 0);
                  return (
                    <TableRow
                      key={rowKey}
                      className={`transition-all duration-700 ${
                        isFading ? "opacity-0 bg-green-50" : ci % 2 === 0 ? "bg-white" : "bg-muted/30"
                      }`}
                    >
                      <TableCell className="align-top pt-2.5 min-w-[120px]">
                        <div className={`font-mono font-bold text-sm ${ci === 0 ? "text-indigo-700" : "text-indigo-300"}`}>{g.code ?? "—"}</div>
                        {ci === 0 && (
                          <div className="text-xs font-sans break-words text-muted-foreground">{g.productName}</div>
                        )}
                        {ci === 0 && g.productSku && (
                          <div className="text-xs font-mono text-indigo-400">{g.productSku}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{colour}</TableCell>
                      {allSizes.map(sz => {
                        const ordQty = g.qty.get(colour)?.get(sz) ?? 0;
                        const cellItemId = g.cellItemId.get(colour)?.get(sz);
                        const cellNote = cellItemId ? (g.cellNote.get(colour)?.get(sz) ?? null) : null;
                        const noteContext = `${g.code ?? g.productName} · ${colour} · ${sz}`;
                        const noteBtn = cellItemId ? (
                          <button
                            className={`absolute top-0.5 right-0.5 transition-opacity rounded ${cellNote ? "opacity-100 text-amber-500" : "opacity-0 group-hover:opacity-50 text-muted-foreground"}`}
                            onClick={e => { e.stopPropagation(); setNoteDialog({ itemId: cellItemId, context: noteContext, current: cellNote ?? "" }); setNoteText(cellNote ?? ""); }}
                            title={cellNote ?? "Add line note"}
                          >
                            <StickyNote className="w-3 h-3" />
                          </button>
                        ) : null;
                        if (!cellItemId) {
                          return <TableCell key={sz} className="text-center p-1"><span className="text-muted-foreground text-xs">—</span></TableCell>;
                        }
                        if (ordQty === 0) {
                          return (
                            <TableCell key={sz} className="text-center p-1 relative group">
                              <span className="text-muted-foreground text-xs">—</span>
                              {onDeleteLine && (
                                <button
                                  className="absolute inset-0 m-auto h-6 w-6 opacity-100 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded flex items-center justify-center"
                                  title="Return this line to purchasing"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setCancelConfirm({ itemId: cellItemId, context: noteContext });
                                  }}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {noteBtn}
                            </TableCell>
                          );
                        }
                        const rcvd = localQtys.get(cellItemId) ?? 0;
                        const cellFull = rcvd >= ordQty;
                        const cellPartial = rcvd > 0 && rcvd < ordQty;
                        const canCancel = onCancelLine && rcvd === 0 && ordQty > 0;
                        const cancelBtn = canCancel ? (
                          <button
                            className="absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-red-500 transition-opacity rounded"
                            title={`Remove outstanding ${ordQty}× ${sz}`}
                            onClick={e => { e.stopPropagation(); setCancelConfirm({ itemId: cellItemId, context: noteContext }); }}
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        ) : null;
                        const cellKey = `${rowKey}||${sz}`;
                        const isFocused = focusedCell === cellKey;
                        return (
                          <TableCell key={sz} className="p-1 text-center relative group">
                            {cancelBtn}
                            <div className="flex flex-col items-center gap-0.5">
                              {isFocused && (
                                <span className="absolute -top-5 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap z-20 pointer-events-none shadow">
                                  {sz}
                                </span>
                              )}
                              <input
                                type="number"
                                min={0}
                                value={rcvd === 0 ? "" : rcvd}
                                placeholder="0"
                                onFocus={() => setFocusedCell(cellKey)}
                                onChange={e => {
                                  const v = parseInt(e.target.value);
                                  handleQtyChange(cellItemId, isNaN(v) ? 0 : Math.max(0, v));
                                }}
                                onBlur={() => {
                                  setFocusedCell(null);
                                  const entered = localQtys.get(cellItemId) ?? 0;
                                  if (entered > 0 && entered !== ordQty) {
                                    setMismatchConfirm({ itemId: cellItemId, entered, expected: ordQty, context: noteContext });
                                  }
                                }}
                                className={`w-12 h-7 text-center text-sm rounded border focus:outline-none focus:ring-2 focus:ring-primary transition-colors ${
                                  cellFull
                                    ? "border-green-400 bg-green-50 text-green-700 font-semibold"
                                    : cellPartial
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : "border-input bg-background text-foreground"
                                }`}
                              />
                              <span className="text-[10px] text-muted-foreground">/{ordQty}</span>
                              {cellNote && (
                                <span className="text-[9px] text-amber-600 max-w-[54px] truncate leading-tight" title={cellNote}>{cellNote}</span>
                              )}
                            </div>
                            {noteBtn}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center text-sm">
                        <span className={rowReceived >= rowOrdered ? "text-green-700 font-bold" : rowReceived > 0 ? "text-amber-700 font-semibold" : "text-muted-foreground"}>
                          {rowReceived}
                        </span>
                        <span className="text-muted-foreground text-xs">/{rowOrdered}</span>
                      </TableCell>
                    </TableRow>
                  );
                });
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {completedRowCount > 0 && !allDone && (
        <p className="text-xs text-green-700 flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />
          {completedRowCount} of {totalRowCount} {completedRowCount === 1 ? "line" : "lines"} fully received — remaining lines will become backorders on completion.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Enter received quantities in each cell. Completed lines disappear automatically. Any undelivered lines become backorders when you click <strong>Complete Delivery</strong>.</p>

      {/* Remove outstanding line confirm dialog */}
      {cancelConfirm && (
        <Dialog open onOpenChange={() => setCancelConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-500" /> Remove Outstanding Line
              </DialogTitle>
              <p className="text-xs text-muted-foreground font-mono pt-0.5">{cancelConfirm.context}</p>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Return it to Purchasing if you need to order it from another supplier. Only write it off if the garments are no longer required.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setCancelConfirm(null)}>Keep</Button>
              {onCancelLine && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => {
                    onCancelLine(poId, cancelConfirm.itemId, cancelConfirm.context);
                    setCancelConfirm(null);
                  }}
                >
                  Write Off
                </Button>
              )}
              {onDeleteLine && (
                <Button
                  size="sm"
                  onClick={() => {
                    onDeleteLine(poId, cancelConfirm.itemId);
                    setCancelConfirm(null);
                  }}
                >
                  Return to Purchasing
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Quantity mismatch confirmation dialog */}
      {mismatchConfirm && (
        <Dialog open onOpenChange={() => setMismatchConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Quantity Mismatch
              </DialogTitle>
              <p className="text-xs text-muted-foreground font-mono pt-0.5">{mismatchConfirm.context}</p>
            </DialogHeader>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span className="font-semibold">{mismatchConfirm.expected}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Entered</span>
                <span className={`font-semibold ${mismatchConfirm.entered > mismatchConfirm.expected ? "text-red-600" : "text-amber-700"}`}>
                  {mismatchConfirm.entered}
                  {mismatchConfirm.entered > mismatchConfirm.expected
                    ? ` (+${mismatchConfirm.entered - mismatchConfirm.expected} over)`
                    : ` (${mismatchConfirm.entered - mismatchConfirm.expected} short)`}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {mismatchConfirm.entered > mismatchConfirm.expected
                ? "You've entered more than was ordered. Are you sure this is correct?"
                : "You've entered less than was ordered. The shortfall will become a backorder on completion."}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  handleQtyChange(mismatchConfirm.itemId, mismatchConfirm.expected);
                  setMismatchConfirm(null);
                }}
              >
                Reset to {mismatchConfirm.expected}
              </Button>
              <Button
                size="sm"
                onClick={() => setMismatchConfirm(null)}
              >
                Keep {mismatchConfirm.entered}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Note edit dialog */}
      {noteDialog && (
        <Dialog open onOpenChange={() => setNoteDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-amber-500" /> Line Note
              </DialogTitle>
              <p className="text-xs text-muted-foreground font-mono pt-0.5">{noteDialog.context}</p>
            </DialogHeader>
            <Textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="e.g. Cancelled from order — do not chase"
              rows={3}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { onSave(poId, noteDialog.itemId, { notes: noteText.trim() || null }); setNoteDialog(null); } }}
            />
            <DialogFooter className="gap-2">
              {noteText && (
                <Button variant="ghost" size="sm" className="text-destructive mr-auto" onClick={() => setNoteText("")}>
                  Clear
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setNoteDialog(null)}>Cancel</Button>
              <Button size="sm" onClick={() => { onSave(poId, noteDialog.itemId, { notes: noteText.trim() || null }); setNoteDialog(null); }}>
                Save note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MarkOrderedDialog({ po, open, onClose, onConfirm }: {
  po: PurchaseOrder;
  open: boolean;
  onClose: () => void;
  onConfirm: (estimatedDeliveryDate: string) => void;
}) {
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 3);
  const [deliveryDate, setDeliveryDate] = useState(defaultDate.toISOString().split("T")[0]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" /> Mark as Ordered — {po.poNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Estimated delivery date</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">You can update this later if dates change.</p>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            This will move the PO to <strong>Ordered</strong> status. The supplier should have already received the PO.
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onConfirm(deliveryDate)} disabled={!deliveryDate}>
            <Send className="w-4 h-4" /> Confirm Ordered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ManualPOLine {
  productName: string;
  colour: string;
  size: string;
  supplierCode: string;
  quantity: string;
  unitPrice: string;
}

function emptyManualLine(): ManualPOLine {
  return { productName: "", colour: "", size: "", supplierCode: "", quantity: "1", unitPrice: "" };
}

function ManualPODialog({ open, onClose, onCreated, allSuppliers }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  allSuppliers: Array<{ id: number; name: string; email?: string | null }>;
}) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ManualPOLine[]>([emptyManualLine()]);
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setSupplierId(null); setSupplierName(""); setSupplierEmail(""); setNotes("");
    setLines([emptyManualLine()]); setSaving(false);
    onClose();
  };

  const handleSupplierSelect = (val: string) => {
    if (val === "__custom__") {
      setSupplierId(null); setSupplierName(""); setSupplierEmail("");
    } else {
      const sup = allSuppliers.find(s => String(s.id) === val);
      if (sup) { setSupplierId(sup.id); setSupplierName(sup.name); setSupplierEmail((sup as any).email ?? ""); }
    }
  };

  const updateLine = (idx: number, field: keyof ManualPOLine, val: string) =>
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  const addLine = () => setLines(prev => [...prev, emptyManualLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  const handleCreate = async () => {
    if (!supplierName.trim()) {
      toast({ title: "Supplier required", description: "Please select or enter a supplier name.", variant: "destructive" });
      return;
    }
    const validLines = lines.filter(l => l.productName.trim() && parseInt(l.quantity) > 0);
    if (validLines.length === 0) {
      toast({ title: "Add at least one valid line", description: "Each line needs a product name and quantity ≥ 1.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/purchasing/purchase-orders/manual", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplierId ?? null,
          supplierName: supplierName.trim(),
          supplierEmail: supplierEmail.trim() || null,
          notes: notes.trim() || null,
          items: validLines.map(l => ({
            productName: l.productName.trim(),
            colour: l.colour.trim() || null,
            size: l.size.trim() || null,
            supplierCode: l.supplierCode.trim() || null,
            quantityOrdered: parseInt(l.quantity),
            supplierPrice: l.unitPrice ? parseFloat(l.unitPrice) : null,
          })),
        }),
      });
      toast({ title: "Draft PO created", description: `Manual PO for ${supplierName} added to Draft tab.` });
      onCreated();
      handleClose();
    } catch (e: any) {
      toast({ title: "Error creating PO", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" /> New Manual Purchase Order
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Select existing supplier</Label>
              <Select onValueChange={handleSupplierSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose supplier…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">— Type manually below —</SelectItem>
                  {allSuppliers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier name <span className="text-muted-foreground text-xs">(editable)</span></Label>
              <Input value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="e.g. Example Supplier" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Supplier email <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)} placeholder="orders@supplier.com" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>PO notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Stock top-up for O114" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Order Lines</Label>
            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs min-w-[180px]">Product Name *</TableHead>
                    <TableHead className="text-xs w-28">Colour</TableHead>
                    <TableHead className="text-xs w-20">Size</TableHead>
                    <TableHead className="text-xs w-28">Supp. Code</TableHead>
                    <TableHead className="text-xs w-16">Qty *</TableHead>
                    <TableHead className="text-xs w-28">Unit Price (£)</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="p-1">
                        <Input value={line.productName} onChange={e => updateLine(idx, "productName", e.target.value)} placeholder="Product name" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input value={line.colour} onChange={e => updateLine(idx, "colour", e.target.value)} placeholder="Red" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input value={line.size} onChange={e => updateLine(idx, "size", e.target.value)} placeholder="M" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input value={line.supplierCode} onChange={e => updateLine(idx, "supplierCode", e.target.value)} placeholder="ABC123" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", e.target.value)} className="h-8 text-sm text-center" />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input type="number" min={0} step={0.01} value={line.unitPrice} onChange={e => updateLine(idx, "unitPrice", e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell className="p-1">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600 p-1 rounded">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addLine}>
              <Plus className="w-3.5 h-3.5" /> Add Row
            </Button>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Create Draft PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function POCard({
  po, onStatusChange, onDelete, onDeleteLine, onLineUpdate, onRefresh, onReceiveAll, onCancelLine, onCleanup, hideMatrix,
}: {
  po: PurchaseOrder;
  onStatusChange: (id: number, status: string, extra?: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onDeleteLine: (poId: number, itemId: number) => void;
  onLineUpdate: (poId: number, itemId: number, data: Record<string, unknown>) => void;
  onRefresh: () => void;
  onReceiveAll: (id: number) => void;
  onCancelLine: (poId: number, itemId: number) => void;
  onCleanup?: (poId: number) => void;
  hideMatrix?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [markOrderedOpen, setMarkOrderedOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addLineForm, setAddLineForm] = useState<ManualPOLine>(emptyManualLine());
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [codeFilter, setCodeFilter] = useState("");
  const latestQtysRef = useRef<Map<number, number>>(new Map());
  const [correctMode, setCorrectMode] = useState(false);
  const [localCorrections, setLocalCorrections] = useState<Map<number, number>>(new Map());
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [reopeningPo, setReopeningPo] = useState(false);
  const [recreditingPo, setRecreditingPo] = useState(false);
  const { toast } = useToast();

  const filteredItems = codeFilter.trim()
    ? po.items.filter((i) => {
        const q = codeFilter.trim().toLowerCase();
        return (
          (i.supplierCode ?? "").toLowerCase().includes(q) ||
          (i.secondarySupplierCode ?? "").toLowerCase().includes(q)
        );
      })
    : po.items;
  const cfg = STATUS_CFG[po.status];
  const StatusIcon = cfg.icon;

  const totalOrdered = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalDelivered = po.items.reduce((s, i) => s + i.quantityDelivered, 0);
  const allDelivered = po.items.length > 0 && po.items.every((i) => i.quantityDelivered >= i.quantityOrdered);
  const someDelivered = po.items.some((i) => i.quantityDelivered > 0);
  const processStockItems = po.items.filter((i) => i.processStockId != null);

  // Auto-complete the PO once server confirms all lines are fully received
  useEffect(() => {
    if (!allDelivered || po.status !== "ordered") return;
    const timer = setTimeout(() => {
      onStatusChange(po.id, "delivered");
    }, 1500);
    return () => clearTimeout(timer);
  }, [allDelivered, po.status, po.id]);
  const totalValue = po.items.reduce((s, i) => s + (i.supplierPrice != null ? i.supplierPrice * i.quantityOrdered : 0), 0);
  const hasValue = po.items.some((i) => i.supplierPrice != null);

  const deliveryLabel = po.estimatedDeliveryDate
    ? new Date(po.estimatedDeliveryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded((e) => !e)}>
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold">{po.poNumber}</span>
              <Badge className={`text-xs gap-1 ${cfg.color}`}><StatusIcon className="w-3 h-3" />{cfg.label}</Badge>
              {po.status === "draft" && someDelivered && (
                <Badge className="text-xs gap-1 bg-amber-100 text-amber-800 border-amber-300 border">
                  <Loader2 className="w-3 h-3" /> Booking in progress
                </Badge>
              )}
              {deliveryLabel && (po.status === "ordered" || someDelivered) && (
                <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                  <CalendarDays className="w-3 h-3" /> Due {deliveryLabel}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium">{po.supplierName}</span>
              <span className="mx-1">·</span>
              <span>{po.items.length} line{po.items.length !== 1 ? "s" : ""}</span>
              <span className="mx-1">·</span>
              {po.status === "delivered" ? (() => {
                const backorderLines = po.items.filter((i) => i.quantityDelivered < i.quantityOrdered).length;
                return backorderLines > 0
                  ? <span className="text-amber-700 font-medium">{backorderLines} on backorder</span>
                  : <span className="text-green-700">fully received</span>;
              })() : (
                <span>{totalOrdered} unit{totalOrdered !== 1 ? "s" : ""}</span>
              )}
              <span className="mx-1">·</span>
              <span className="font-semibold text-foreground">
                {hasValue ? `${currencySymbol(po.supplierCurrency)}${totalValue.toFixed(2)}` : "—"}
              </span>
              <span className="mx-1">·</span>
              <span>{formatDate(po.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {po.status === "draft" && onCleanup && (
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={cleaningUp}
              title="Remove lines that have already been received into stock"
              onClick={async () => {
                setCleaningUp(true);
                try {
                  const res = await apiFetch<{ removed: number; remaining: number }>(
                    `/purchasing/purchase-orders/${po.id}/cleanup-fulfilled`, { method: "POST" }
                  );
                  if (res.removed === 0) {
                    alert("No fulfilled lines found — all lines still need ordering.");
                  } else {
                    alert(`Removed ${res.removed} already-fulfilled line${res.removed !== 1 ? "s" : ""}. ${res.remaining} line${res.remaining !== 1 ? "s" : ""} remain.`);
                    onCleanup(po.id);
                  }
                } catch (e: any) {
                  alert("Error: " + e.message);
                } finally {
                  setCleaningUp(false);
                }
              }}
            >
              {cleaningUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Clean up
            </Button>
          )}
          {(po.status === "draft" || po.status === "ordered") && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setEmailOpen(true)}>
              <Mail className="w-3.5 h-3.5" /> Email PO
            </Button>
          )}
          {po.status === "draft" && (
            <Button size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setMarkOrderedOpen(true)}>
              <Send className="w-3.5 h-3.5" /> Mark Ordered
            </Button>
          )}
          {(po.status === "ordered" || (po.status === "draft" && someDelivered)) && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs border-green-400 text-green-700 hover:bg-green-50"
              onClick={() => { if (confirm("Receive full delivery? All lines will be marked as fully delivered.")) onReceiveAll(po.id); }}>
              <PackageCheck className="w-3.5 h-3.5" /> Receive All
            </Button>
          )}
          {(po.status === "ordered" || (po.status === "draft" && someDelivered)) && (allDelivered || someDelivered) && (
            <Button
              size="sm"
              className={`gap-1.5 text-xs text-white ${allDelivered ? "bg-green-600 hover:bg-green-700" : "bg-amber-600 hover:bg-amber-700"}`}
              title={allDelivered
                ? "Close this PO and allocate received stock to orders"
                : "Record this partial delivery — backordered lines will remain tracked until they arrive"}
              onClick={() => {
                const qtys = [...latestQtysRef.current.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
                onStatusChange(po.id, "delivered", qtys.length > 0 ? { quantities: qtys } : undefined);
              }}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              {allDelivered ? "Complete Delivery" : "Book Partial Delivery"}
            </Button>
          )}
          {po.status === "delivered" && (
            <Button
              size="sm" variant="outline"
              className={`gap-1.5 text-xs ${correctMode ? "border-orange-500 bg-orange-50 text-orange-700" : "border-orange-400 text-orange-700 hover:bg-orange-50"}`}
              onClick={(e) => { e.stopPropagation(); setCorrectMode(!correctMode); if (!correctMode) setExpanded(true); setLocalCorrections(new Map()); }}
              title="Correct received quantities on this delivered PO"
            >
              <Pencil className="w-3.5 h-3.5" /> {correctMode ? "Cancel Correction" : "Correct Book-in"}
            </Button>
          )}
          {po.status === "delivered" && processStockItems.length > 0 && (
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs border-indigo-400 text-indigo-700 hover:bg-indigo-50"
              disabled={recreditingPo}
              title="Re-apply stock credit for all process stock lines on this PO"
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(`Re-credit process stock for ${po.poNumber}?\n\nThis will add the delivered quantities back to each process stock item's available stock. Only use this if the stock wasn't updated when the PO was originally received.`)) return;
                setRecreditingPo(true);
                try {
                  const result: { credited: { sku: string; qty: number }[] } = await apiFetch(`/purchasing/purchase-orders/${po.id}/reapply-process-stock`, { method: "POST" });
                  onRefresh();
                  toast({ title: "Stock credited", description: `Credited ${result.credited.map(c => `${c.sku} ×${c.qty}`).join(", ")}` });
                } catch (err: any) {
                  toast({ title: "Error re-crediting stock", description: err.message, variant: "destructive" });
                } finally {
                  setRecreditingPo(false);
                }
              }}
            >
              {recreditingPo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
              Re-credit Stock
            </Button>
          )}
          {po.status === "delivered" && (
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={reopeningPo}
              title="Return PO to Awaiting Delivery to re-enter quantities"
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(`Re-open ${po.poNumber}?\n\nThis will reset all received quantities and return the PO to Awaiting Delivery. Items already being picked or in production will NOT be affected.`)) return;
                setReopeningPo(true);
                try {
                  await apiFetch(`/purchasing/purchase-orders/${po.id}/reopen`, { method: "POST" });
                  onRefresh();
                  toast({ title: "PO re-opened", description: `${po.poNumber} is back in Awaiting Delivery — enter the correct quantities to complete the booking.` });
                } catch (err: any) {
                  toast({ title: "Error re-opening PO", description: err.message, variant: "destructive" });
                } finally {
                  setReopeningPo(false);
                }
              }}
            >
              {reopeningPo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Re-open PO
            </Button>
          )}
          {(po.status === "draft" || po.status === "ordered") && (
            <Button
              size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50"
              title="Delete this purchase order"
              onClick={() => {
                const msg = po.status === "ordered"
                  ? `Delete PO ${po.poNumber}? This PO has already been marked as ordered. All lines will return to the purchasing requirements list.`
                  : `Delete draft PO ${po.poNumber}?`;
                if (confirm(msg)) onDelete(po.id);
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          {po.notes && <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{po.notes}</div>}
          {po.attachments && po.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {po.attachments.map((att, i) => (
                <a
                  key={i}
                  href={`${API_BASE}/storage${att.objectPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground" />
                  {att.name}
                </a>
              ))}
            </div>
          )}
          {po.items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No lines on this PO yet.</div>
          ) : (
            <>
              {!hideMatrix && (
                <POMatrixView
                  items={po.items}
                  currency={po.supplierCurrency}
                  onDeleteLine={po.status !== "delivered" ? (itemId) => onDeleteLine(po.id, itemId) : undefined}
                  onLineUpdate={(po.status === "draft" || po.status === "ordered") ? (itemId, qty) => onLineUpdate(po.id, itemId, { quantityOrdered: qty }) : undefined}
                  onDueDateChange={po.status === "ordered" ? (itemIds, date) => {
                    itemIds.forEach(itemId => onLineUpdate(po.id, itemId, { estimatedDueDate: date }));
                  } : undefined}
                />
              )}

              {po.status === "ordered" && (
                <div className={`space-y-3 ${!hideMatrix ? "pt-3 border-t border-border" : ""}`}>
                  {!hideMatrix && (
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5" /> Book In Delivery
                    </h4>
                  )}
                  <BookInMatrix
                    items={po.items}
                    poId={po.id}
                    onSave={(poId, itemId, data) => onLineUpdate(poId, itemId, data)}
                    onQtysChange={(qtys) => { latestQtysRef.current = qtys; }}
                    onCancelLine={(poId, itemId) => onCancelLine(poId, itemId)}
                    onDeleteLine={(poId, itemId) => onDeleteLine(poId, itemId)}
                  />
                </div>
              )}

              {po.status === "delivered" && correctMode && (
                <div className="pt-3 border-t border-border space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Pencil className="w-3.5 h-3.5 text-orange-500" /> Correct Received Quantities
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Edit the actual received quantity for each line. Lines set below the ordered quantity will be returned to the purchasing queue.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs">Product</TableHead>
                          <TableHead className="text-xs">Colour</TableHead>
                          <TableHead className="text-xs">Size</TableHead>
                          <TableHead className="text-xs text-center">Ordered</TableHead>
                          <TableHead className="text-xs text-center w-28">Received</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {po.items.map(item => {
                          const corrected = localCorrections.has(item.id) ? localCorrections.get(item.id)! : item.quantityDelivered;
                          const changed = corrected !== item.quantityDelivered;
                          const short = corrected < item.quantityOrdered;
                          return (
                            <TableRow key={item.id} className={changed ? "bg-orange-50/60" : ""}>
                              <TableCell className="text-xs font-medium">
                                {item.supplierCode && <span className="font-mono text-indigo-700 mr-1">{item.supplierCode}</span>}
                                {item.productName}
                              </TableCell>
                              <TableCell className="text-xs">{item.colour ?? "—"}</TableCell>
                              <TableCell className="text-xs">{item.size ?? "—"}</TableCell>
                              <TableCell className="text-xs text-center font-semibold">{item.quantityOrdered}</TableCell>
                              <TableCell className="text-xs text-center p-1">
                                <div className="flex flex-col items-center gap-0.5">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={corrected}
                                    onChange={e => {
                                      const v = Math.max(0, parseInt(e.target.value) || 0);
                                      setLocalCorrections(prev => new Map(prev).set(item.id, v));
                                    }}
                                    className={`h-7 w-20 text-xs text-center ${short ? "border-amber-400 bg-amber-50" : ""}`}
                                  />
                                  {short && <span className="text-[10px] text-amber-600">↑ short</span>}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                      disabled={savingCorrections}
                      onClick={async () => {
                        const changes = po.items.filter(i =>
                          localCorrections.has(i.id) && localCorrections.get(i.id) !== i.quantityDelivered
                        );
                        if (changes.length === 0) { setCorrectMode(false); return; }
                        setSavingCorrections(true);
                        try {
                          for (const item of changes) {
                            await apiFetch(`/purchasing/purchase-orders/${po.id}/items/${item.id}/set-delivered`, {
                              method: "PATCH",
                              body: JSON.stringify({ quantityDelivered: localCorrections.get(item.id) }),
                            });
                          }
                          onRefresh();
                          setCorrectMode(false);
                          setLocalCorrections(new Map());
                          toast({ title: "Quantities corrected", description: `${changes.length} line${changes.length !== 1 ? "s" : ""} updated and allocation re-run.` });
                        } catch (err: any) {
                          toast({ title: "Error saving corrections", description: err.message, variant: "destructive" });
                        } finally {
                          setSavingCorrections(false);
                        }
                      }}
                    >
                      {savingCorrections ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Save Corrections
                    </Button>
                    <Button
                      size="sm" variant="outline" className="text-xs"
                      disabled={savingCorrections}
                      onClick={() => { setCorrectMode(false); setLocalCorrections(new Map()); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {po.status === "draft" && (
            <div className="pt-2 border-t border-border">
              {!addLineOpen ? (
                <button
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                  onClick={() => setAddLineOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5" /> Add manual line
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Add Manual Line</p>
                  <div className="grid grid-cols-6 gap-1.5 items-center">
                    <div className="col-span-2">
                      <Input
                        value={addLineForm.productName}
                        onChange={e => setAddLineForm(f => ({ ...f, productName: e.target.value }))}
                        placeholder="Product name *"
                        className="h-8 text-xs"
                      />
                    </div>
                    <Input
                      value={addLineForm.colour}
                      onChange={e => setAddLineForm(f => ({ ...f, colour: e.target.value }))}
                      placeholder="Colour"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={addLineForm.size}
                      onChange={e => setAddLineForm(f => ({ ...f, size: e.target.value }))}
                      placeholder="Size"
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={addLineForm.quantity}
                      onChange={e => setAddLineForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="Qty *"
                      className="h-8 text-xs text-center"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={addLineForm.unitPrice}
                      onChange={e => setAddLineForm(f => ({ ...f, unitPrice: e.target.value }))}
                      placeholder="£ price"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={addLineForm.supplierCode}
                      onChange={e => setAddLineForm(f => ({ ...f, supplierCode: e.target.value }))}
                      placeholder="Supplier code (optional)"
                      className="h-8 text-xs max-w-[180px]"
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={addLineSaving || !addLineForm.productName.trim() || parseInt(addLineForm.quantity) < 1}
                      onClick={async () => {
                        setAddLineSaving(true);
                        try {
                          await apiFetch(`/purchasing/purchase-orders/${po.id}/process-stock-items`, {
                            method: "POST",
                            body: JSON.stringify({
                              items: [{
                                productName: addLineForm.productName.trim(),
                                colour: addLineForm.colour.trim() || null,
                                size: addLineForm.size.trim() || null,
                                supplierCode: addLineForm.supplierCode.trim() || null,
                                quantityOrdered: parseInt(addLineForm.quantity),
                                supplierPrice: addLineForm.unitPrice ? parseFloat(addLineForm.unitPrice) : null,
                              }],
                            }),
                          });
                          onRefresh();
                          setAddLineOpen(false);
                          setAddLineForm(emptyManualLine());
                        } catch { /* silent */ }
                        setAddLineSaving(false);
                      }}
                    >
                      {addLineSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Save Line
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setAddLineOpen(false); setAddLineForm(emptyManualLine()); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {emailOpen && (
        <POEmailDialog po={po} open={emailOpen} onClose={() => setEmailOpen(false)} onSent={onRefresh} onFileUploaded={onRefresh} />
      )}
      {markOrderedOpen && (
        <MarkOrderedDialog
          po={po}
          open={markOrderedOpen}
          onClose={() => setMarkOrderedOpen(false)}
          onConfirm={(date) => { onStatusChange(po.id, "ordered", { estimatedDeliveryDate: date }); setMarkOrderedOpen(false); }}
        />
      )}
    </div>
  );
}

function AddManualReqDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [colour, setColour] = useState("");
  const [size, setSize] = useState("");
  const [sleeve, setSleeve] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: productResults = [], isFetching: searching } = useQuery<any[]>({
    queryKey: ["product-search-manual-req", debouncedSearch],
    queryFn: () => apiFetch(`/products?search=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.length >= 2,
  });

  const handleSelectProduct = async (product: any) => {
    setSelectedProduct(product);
    setColour(""); setSize(""); setSleeve("");
    try {
      const v = await apiFetch<any[]>(`/products/${product.id}/variants`);
      setVariants(v);
    } catch { setVariants([]); }
  };

  const uniqueColours = useMemo(() => [...new Set(variants.map((v: any) => v.colour).filter(Boolean))], [variants]);
  const sizesForColour = useMemo(() => {
    const filtered = variants.filter((v: any) => !colour || v.colour === colour);
    return [...new Set(filtered.map((v: any) => v.size).filter(Boolean))];
  }, [variants, colour]);
  const sleevesForColourAndSize = useMemo(() => {
    const filtered = variants.filter((v: any) =>
      (!colour || v.colour === colour) && (!size || v.size === size) && v.sleeve
    );
    return [...new Set(filtered.map((v: any) => v.sleeve as string))];
  }, [variants, colour, size]);
  const hasSleeveDimension = sleevesForColourAndSize.length > 0;

  const handleSubmit = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    // Combine size/sleeve the same way order_items does for sleeve products
    const combinedSize = size && sleeve ? `${size}/${sleeve}` : size || null;
    try {
      await apiFetch("/purchasing/manual-requirements", {
        method: "POST",
        body: JSON.stringify({ productId: selectedProduct.id, productName: selectedProduct.name, productSku: selectedProduct.sku || null, colour: colour || null, size: combinedSize, quantity }),
      });
      const sizeLabel = size && sleeve ? `${size} / ${sleeve}` : size || "";
      toast({ title: "Requirement added", description: `${selectedProduct.name}${colour ? ` · ${colour}` : ""}${sizeLabel ? ` / ${sizeLabel}` : ""} × ${quantity}` });
      onAdded(); handleClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleClose = () => {
    setSearch(""); setDebouncedSearch(""); setSelectedProduct(null);
    setVariants([]); setColour(""); setSize(""); setSleeve(""); setQuantity(1);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" /> Add Manual Requirement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!selectedProduct ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Search by SKU or product name</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search by code or product name…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
                </div>
              </div>
              {debouncedSearch.length >= 2 && (
                <div className="border border-border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {searching && (
                    <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Searching...
                    </div>
                  )}
                  {!searching && productResults.length === 0 && (
                    <div className="py-6 text-center text-muted-foreground text-sm">No products found</div>
                  )}
                  {!searching && productResults.map((p: any) => (
                    <button key={p.id} className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors" onClick={() => handleSelectProduct(p)}>
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="flex gap-2 mt-0.5">
                        {p.sku && <span className="font-mono text-xs text-indigo-500">{p.sku}</span>}
                        {p.supplierCode && <span className="text-xs text-muted-foreground">Supplier code: {p.supplierCode}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <div>
                  <div className="font-semibold text-sm">{selectedProduct.name}</div>
                  {selectedProduct.sku && <div className="font-mono text-xs text-indigo-500 mt-0.5">{selectedProduct.sku}</div>}
                </div>
                <button className="text-muted-foreground hover:text-foreground mt-0.5" onClick={() => { setSelectedProduct(null); setVariants([]); }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Colour</Label>
                  {uniqueColours.length > 0 ? (
                    <Select value={colour} onValueChange={(v) => { setColour(v); setSize(""); setSleeve(""); }}>
                      <SelectTrigger><SelectValue placeholder="Select colour" /></SelectTrigger>
                      <SelectContent>{uniqueColours.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input placeholder="e.g. Black/Purple" value={colour} onChange={(e) => setColour(e.target.value)} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Size</Label>
                  {sizesForColour.length > 0 ? (
                    <Select value={size} onValueChange={(v) => { setSize(v); setSleeve(""); }}>
                      <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                      <SelectContent>{sizesForColour.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input placeholder="e.g. L, XL, one size" value={size} onChange={(e) => setSize(e.target.value)} />
                  )}
                </div>
              </div>
              {hasSleeveDimension && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Sleeve Length</Label>
                  <Select value={sleeve} onValueChange={setSleeve}>
                    <SelectTrigger><SelectValue placeholder="Select sleeve length" /></SelectTrigger>
                    <SelectContent>{sleevesForColourAndSize.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Quantity</Label>
                <div className="flex items-center gap-2">
                  <button type="button" className="w-8 h-8 rounded border border-border bg-background hover:bg-muted flex items-center justify-center text-lg leading-none" onClick={() => setQuantity(q => Math.max(1, q - 1))}>−</button>
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} className="w-20 text-center font-semibold" />
                  <button type="button" className="w-8 h-8 rounded border border-border bg-background hover:bg-muted flex items-center justify-center text-lg leading-none" onClick={() => setQuantity(q => q + 1)}>+</button>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {selectedProduct && (
            <Button onClick={handleSubmit} disabled={saving || quantity < 1} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Requirement
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Purchasing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [nextStepData, setNextStepData] = useState<AllocationResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedReqGroups, setExpandedReqGroups] = useState<Record<string, boolean>>({});
  const [expandedPsGroups, setExpandedPsGroups] = useState<Record<string, boolean>>({});
  const [reqQtyOverrides, setReqQtyOverrides] = useState<Record<string, Record<string, number>>>({});
  const [psQtyOverrides, setPsQtyOverrides] = useState<Record<string, Record<number, number>>>({});
  const [emailGroup, setEmailGroup] = useState<SupplierGroup | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [poSearch, setPoSearch] = useState("");
  const [completedSearch, setCompletedSearch] = useState("");
  const [createPoGroup, setCreatePoGroup] = useState<SupplierGroup | null>(null);
  const [createPoNotes, setCreatePoNotes] = useState("");
  const [createProcessPoGroup, setCreateProcessPoGroup] = useState<{ supplierId: number | null; supplierName: string; items: ProcessStockRequirement[] } | null>(null);
  const [createProcessPoNotes, setCreateProcessPoNotes] = useState("");
  const [processPoQtys, setProcessPoQtys] = useState<Record<number, number>>({});
  const [selectedOrdersSupplier, setSelectedOrdersSupplier] = useState<string | null>(null);
  const [selectedCompletedSupplier, setSelectedCompletedSupplier] = useState<string | null>(null);
  const [selectedDraftSupplier, setSelectedDraftSupplier] = useState<string | null>(null);
  const [selectedBackordersSupplier, setSelectedBackordersSupplier] = useState<string | null>(null);
  const [manualPOOpen, setManualPOOpen] = useState(false);
  const [addManualReqOpen, setAddManualReqOpen] = useState(false);

  const { data: groups = [], isFetching: reqFetching, refetch: refetchReqs } = useQuery<SupplierGroup[]>({
    queryKey: ["purchasing-requirements"],
    queryFn: () => apiFetch("/purchasing/requirements"),
    refetchInterval: 15_000,
  });

  const { data: purchaseOrders = [], isFetching: posFetching, refetch: refetchPos } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders"],
    queryFn: () => apiFetch("/purchasing/purchase-orders"),
    refetchInterval: 15_000,
  });

  const [isRechecking, setIsRechecking] = useState(false);

  async function recheckAndRefresh() {
    setIsRechecking(true);
    try {
      await apiFetch("/purchasing/recheck-stock", { method: "POST" });
    } catch { /* best-effort */ }
    await Promise.all([refetchReqs(), refetchPos()]);
    setIsRechecking(false);
  }

  // On mount, run a rescan to restore any requirements lost due to PO deletion
  // bugs. Fires once when the Purchasing page is opened.
  useEffect(() => {
    apiFetch("/purchasing/rescan", { method: "POST" })
      .then((res: { restored: number }) => {
        if (res.restored > 0) {
          refetchReqs();
        }
      })
      .catch(() => { /* silent — rescan is best-effort */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: allSuppliers = [] } = useListSuppliers();
  const supplierLogoMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const s of allSuppliers) {
      map.set(s.name.toLowerCase(), (s as any).logoUrl ?? null);
    }
    return map;
  }, [allSuppliers]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
  };

  const createPoMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/purchasing/purchase-orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      setCreatePoGroup(null); setCreatePoNotes("");
      toast({ title: "Draft PO created", description: "It appears in the Draft tab below the requirements." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createProcessPoMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/purchasing/purchase-orders/for-process-stock", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] });
      setCreateProcessPoGroup(null); setCreateProcessPoNotes(""); setProcessPoQtys({});
      setPsQtyOverrides({});
      toast({ title: "Draft PO created", description: "Process material PO added to the Draft tab." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addProcessStockToPoMutation = useMutation({
    mutationFn: ({ poId, items }: { poId: number; items: ProcessStockRequirement[] }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/process-stock-items`, {
        method: "POST",
        body: JSON.stringify({
          items: items.map(r => ({
            processStockId: r.processStockId,
            quantityOrdered: r.shortfall,
          })),
        }),
      }),
    onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] }); setPsQtyOverrides({}); toast({ title: "Added to draft PO" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addToPoMutation = useMutation({
    mutationFn: ({ poId, itemIds, manualReqIds }: { poId: number; itemIds: number[]; manualReqIds: number[] }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items`, { method: "POST", body: JSON.stringify({ itemIds, manualReqIds }) }),
    onSuccess: () => { invalidateAll(); toast({ title: "Items added to draft PO" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, extra }: { id: number; status: string; extra?: Record<string, unknown> }) =>
      apiFetch<{ allocation?: AllocationResult }>(`/purchasing/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status, ...extra }) }),
    onSuccess: (data, vars) => {
      invalidateAll();
      setStatusFilter("all");
      if (vars.status === "delivered" && data?.allocation && data.allocation.pickingItems > 0) {
        setNextStepData(data.allocation);
        // Auto-print picking slip + worksheets for decorated items
        const affectedOrderIds = (data.allocation.summary ?? [])
          .filter((s) => s.pickingCount > 0 || s.worksheetCount > 0)
          .map((s) => s.orderId);
        if (affectedOrderIds.length > 0) printBookInSlip(affectedOrderIds);
      } else {
        const msgs: Record<string, string> = {
          ordered: "PO marked as Ordered — now showing in the Ordered tab.",
          delivered: "Delivery booked — PO moved to Delivered.",
          draft: "PO moved back to Draft.",
        };
        toast({ title: "Status updated", description: msgs[vars.status] });
        // Even with no picking items, still check if any decorated items need worksheets
        if (vars.status === "delivered") {
          const affectedOrderIds = (data?.allocation?.summary ?? [])
            .filter((s) => s.pickingCount > 0 || s.worksheetCount > 0)
            .map((s) => s.orderId);
          if (affectedOrderIds.length > 0) printBookInSlip(affectedOrderIds);
        }
      }
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const receiveAllMutation = useMutation({
    mutationFn: (id: number) => apiFetch<{ allocation?: AllocationResult }>(`/purchasing/purchase-orders/${id}/receive-all`, { method: "POST" }),
    onSuccess: (data) => {
      invalidateAll();
      if (data?.allocation && data.allocation.pickingItems > 0) {
        setNextStepData(data.allocation);
        // Auto-open picking slips for all affected orders
        const affectedOrderIds = (data.allocation.summary ?? [])
          .filter((s) => s.pickingCount > 0 || s.worksheetCount > 0)
          .map((s) => s.orderId);
        if (affectedOrderIds.length > 0) printBookInSlip(affectedOrderIds);
      } else {
        toast({ title: "Delivery booked in", description: "All lines marked as received." });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/purchasing/purchase-orders/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateAll(); toast({ title: "PO deleted" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteLineMutation = useMutation({
    mutationFn: ({ poId, itemId }: { poId: number; itemId: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] });
      toast({ title: "Line removed", description: "Item returned to purchasing requirements." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelLineMutation = useMutation({
    mutationFn: ({ poId, itemId }: { poId: number; itemId: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}/cancel-outstanding`, { method: "POST" }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] });
      toast({ title: "Line cancelled", description: "Outstanding quantity written off — no backorder will be created." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRequirementMutation = useMutation({
    mutationFn: async (itemIds: number[]) => {
      const regularIds = itemIds.filter(id => id > 0);
      const manualIds = itemIds.filter(id => id < 0).map(id => -id);
      const calls: Promise<unknown>[] = [];
      if (regularIds.length > 0) calls.push(apiFetch(`/purchasing/requirements`, { method: "DELETE", body: JSON.stringify({ itemIds: regularIds }) }));
      for (const mid of manualIds) calls.push(apiFetch(`/purchasing/manual-requirements/${mid}`, { method: "DELETE" }));
      return Promise.all(calls);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Requirement removed", description: "Stock checked and requirement cleared." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const lineUpdateMutation = useMutation({
    mutationFn: ({ poId, itemId, data }: { poId: number; itemId: number; data: Record<string, unknown> }) =>
      apiFetch<any>(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (response: any) => {
      if (response?.autoCompleted) {
        // PO transitioned ordered → delivered: full refetch needed so it moves to Completed tab
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
        queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
        if (response?.allocation) {
          const affectedOrderIds: number[] = (response.allocation.summary ?? [])
            .filter((s: any) => s.pickingCount > 0 || s.worksheetCount > 0)
            .map((s: any) => s.orderId);
          if (affectedOrderIds.length > 0) printBookInSlip(affectedOrderIds);
        }
      } else if (response?.consolidatedProcessStock) {
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] });
        toast({ title: "Quantity updated", description: "Duplicate process-stock lines were combined into one PO line." });
      }
      // For routine debounced cell saves the user already sees what they typed —
      // no refetch needed.  Skipping ["purchase-orders"] invalidation prevents
      // draft PO cards from unnecessarily re-rendering mid-entry.
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reqQtyMutation = useMutation({
    mutationFn: ({ orderId, itemId, purchaseQuantity }: { orderId: number; itemId: number; purchaseQuantity: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ purchaseQuantity }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
    },
    onError: (e: Error) => toast({ title: "Error updating quantity", description: e.message, variant: "destructive" }),
  });

  const clearBackorderMutation = useMutation({
    mutationFn: ({ poId, itemId, quantityOrdered }: { poId: number; itemId: number; quantityOrdered: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ quantityDelivered: quantityOrdered }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Backorder cleared", description: "Line marked as fully received." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [backorderDrafts, setBackorderDrafts] = useState<Record<number, string>>({});

  const bookInBackorderMutation = useMutation({
    mutationFn: ({ poId, itemId, quantity }: { poId: number; itemId: number; quantity: number; remaining: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}/receive`, { method: "POST", body: JSON.stringify({ quantity }) }),
    onSuccess: (data: any, { itemId, quantity, remaining }) => {
      setBackorderDrafts(prev => { const next = { ...prev }; delete next[itemId]; return next; });
      // Always refresh the backorders list since quantities have changed
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      if (data?.autoCompleted) {
        // PO transitioned to delivered: full refetch so it moves to Completed tab
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      }
      // Otherwise skip ["purchase-orders"] invalidation — backorders live on delivered
      // POs and draft PO cards don't need to re-render for every backorder book-in.
      const isComplete = quantity >= remaining;
      toast({
        title: isComplete ? "Backorder cleared" : "Delivery booked",
        description: isComplete
          ? "Line fully received and allocated to orders."
          : `${quantity} unit${quantity !== 1 ? "s" : ""} received — ${remaining - quantity} still outstanding.`,
      });
      // Auto-open picking slip / worksheet for any orders now ready
      const affectedOrderIds: number[] = (data?.allocation?.summary ?? [])
        .filter((s: any) => s.pickingCount > 0 || s.worksheetCount > 0)
        .map((s: any) => s.orderId);
      if (affectedOrderIds.length > 0) {
        printBookInSlip(affectedOrderIds);
      }
    },
    onError: (e: Error) => toast({ title: "Error booking in", description: e.message, variant: "destructive" }),
  });

  const undoBookInMutation = useMutation({
    mutationFn: ({ poId, itemId }: { poId: number; itemId: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}/set-delivered`, { method: "PATCH", body: JSON.stringify({ quantityDelivered: 0 }) }),
    onSuccess: (_data, { itemId }) => {
      setBackorderDrafts(prev => { const next = { ...prev }; delete next[itemId]; return next; });
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      toast({ title: "Book-in undone", description: "Delivered quantity reset to 0." });
    },
    onError: (e: Error) => toast({ title: "Error undoing book-in", description: e.message, variant: "destructive" }),
  });

  const [cancelReorderDialog, setCancelReorderDialog] = useState<BackorderLine | null>(null);
  const [cancelEmailTo, setCancelEmailTo] = useState("");
  const [cancelEmailSubject, setCancelEmailSubject] = useState("");
  const [cancelEmailBody, setCancelEmailBody] = useState("");

  const cancelAndReorderMutation = useMutation({
    mutationFn: ({ poId, itemId, emailTo, emailSubject, emailBody }: {
      poId: number; itemId: number; emailTo: string; emailSubject: string; emailBody: string;
    }) => apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}/cancel-and-reorder`, {
      method: "POST",
      body: JSON.stringify({ emailTo: emailTo || undefined, emailSubject: emailSubject || undefined, emailBody: emailBody || undefined }),
    }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setCancelReorderDialog(null);
      toast({
        title: "Backorder cancelled & re-queued",
        description: data?.emailSent
          ? "Cancellation email sent. Items added back to purchasing requirements."
          : "Items added back to purchasing requirements. No email sent.",
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCancelReorder(b: BackorderLine) {
    setCancelEmailTo(b.supplierEmail ?? "");
    setCancelEmailSubject(`Cancellation of outstanding backorder — ${b.poNumber}`);
    const lines = [b.colour, b.size].filter(Boolean).join(" / ");
    const variantStr = lines ? ` (${lines})` : "";
    const body = [
      `Dear ${b.supplierName},`,
      ``,
      `We are writing to advise that we are cancelling the remaining outstanding quantity on the above purchase order.`,
      ``,
      `Product: ${b.productName}${variantStr}`,
      `PO Number: ${b.poNumber}`,
      `Outstanding quantity being cancelled: ${b.remaining}`,
      ``,
      `Please do not dispatch the above quantity. We will be sourcing this stock from an alternative supplier.`,
      ``,
      `We apologise for any inconvenience caused and thank you for your understanding.`,
      ``,
      `Kind regards,`,
      `Your business`,
    ].join("\n");
    setCancelEmailBody(body);
    setCancelReorderDialog(b);
  }

  const toggleGroup = (name: string) => setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const { data: backorders = [] } = useQuery<BackorderLine[]>({
    queryKey: ["purchasing-backorders"],
    queryFn: () => apiFetch("/purchasing/backorders"),
    refetchInterval: 15_000,
  });

  const { data: processStockReqs = [] } = useQuery<ProcessStockRequirement[]>({
    queryKey: ["process-stock-requirements"],
    queryFn: () => apiFetch("/purchasing/process-stock-requirements"),
    refetchInterval: 15_000,
  });
  const processShortfallCount = processStockReqs.filter(r => r.shortfall > 0).length;
  const processReqsBySupplier = Object.values(
    processStockReqs
      .filter(r => r.shortfall > 0)
      .reduce((acc, req) => {
        const key = String(req.supplierId ?? req.supplierName ?? "unknown");
        if (!acc[key]) acc[key] = { supplierId: req.supplierId, supplierName: req.supplierName ?? "Unknown Supplier", items: [] };
        acc[key].items.push(req);
        return acc;
      }, {} as Record<string, { supplierId: number | null; supplierName: string; items: ProcessStockRequirement[] }>)
  );

  const draftPos = purchaseOrders.filter((po) => po.status === "draft" && !po.items.some(i => i.quantityDelivered > 0));
  const filteredPos = purchaseOrders.filter((po) =>
    po.status === "ordered" || (po.status === "draft" && po.items.some(i => i.quantityDelivered > 0))
  );
  const draftCount = draftPos.length;
  const orderedCount = filteredPos.length;
  const deliveredCount = purchaseOrders.filter((p) => p.status === "delivered").length;

  const orderedBySupplier = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const po of filteredPos) {
      if (!map.has(po.supplierName)) map.set(po.supplierName, []);
      map.get(po.supplierName)!.push(po);
    }
    return [...map.entries()].map(([name, pos]) => ({ name, pos }));
  }, [filteredPos]);

  const deliveredBySupplier = useMemo(() => {
    const delivered = purchaseOrders.filter((p) => p.status === "delivered");
    const map = new Map<string, PurchaseOrder[]>();
    for (const po of delivered) {
      if (!map.has(po.supplierName)) map.set(po.supplierName, []);
      map.get(po.supplierName)!.push(po);
    }
    return [...map.entries()].map(([name, pos]) => ({ name, pos }));
  }, [purchaseOrders]);

  const draftTilesBySupplier = useMemo(() => {
    const pickEarlier = (a: string | null, b: string | null): string | null => {
      if (!a) return b;
      if (!b) return a;
      return a < b ? a : b;
    };
    const map = new Map<string, { name: string; reqLines: number; psLines: number; poCount: number; supplierId: number | null; totalValue: number | null; totalRevenue: number | null; earliestCreatedAt: string | null }>();
    for (const g of groups) {
      const key = g.supplierName;
      if (!map.has(key)) map.set(key, { name: key, reqLines: 0, psLines: 0, poCount: 0, supplierId: g.supplierId, totalValue: null, totalRevenue: null, earliestCreatedAt: null });
      const tile = map.get(key)!;
      tile.reqLines += g.items.reduce((s, item) => s + (item.purchaseQuantity ?? 1), 0);
      for (const item of g.items) {
        const qty = item.purchaseQuantity ?? 1;
        if (item.supplierPrice != null && item.purchaseQuantity != null) {
          tile.totalValue = (tile.totalValue ?? 0) + item.supplierPrice * qty;
        }
        if (item.unitPrice != null) {
          tile.totalRevenue = (tile.totalRevenue ?? 0) + parseFloat(String(item.unitPrice)) * qty;
        }
        tile.earliestCreatedAt = pickEarlier(tile.earliestCreatedAt, item.queuedAt ?? item.orderCreatedAt);
      }
    }
    for (const g of processReqsBySupplier) {
      const key = g.supplierName;
      if (!map.has(key)) map.set(key, { name: key, reqLines: 0, psLines: 0, poCount: 0, supplierId: g.supplierId, totalValue: null, totalRevenue: null, earliestCreatedAt: null });
      map.get(key)!.psLines += g.items.reduce((s, item) => s + (item.shortfall ?? 1), 0);
    }
    for (const po of draftPos) {
      const key = po.supplierName;
      if (!map.has(key)) map.set(key, { name: key, reqLines: 0, psLines: 0, poCount: 0, supplierId: po.supplierId, totalValue: null, totalRevenue: null, earliestCreatedAt: null });
      const tile = map.get(key)!;
      tile.poCount += 1;
      tile.earliestCreatedAt = pickEarlier(tile.earliestCreatedAt, po.createdAt);
      for (const item of po.items) {
        if (item.supplierPrice != null) {
          tile.totalValue = (tile.totalValue ?? 0) + item.supplierPrice * item.quantityOrdered;
        }
      }
    }
    return [...map.values()];
  }, [groups, processReqsBySupplier, draftPos]);

  const backordersBySupplier = useMemo(() => {
    const map = new Map<string, BackorderLine[]>();
    for (const b of backorders) {
      if (!map.has(b.supplierName)) map.set(b.supplierName, []);
      map.get(b.supplierName)!.push(b);
    }
    return [...map.entries()].map(([name, lines]) => ({ name, lines }));
  }, [backorders]);

  const getDraftPoForSupplier = (
    supplierId: number | null,
    supplierName: string,
    type: "garment" | "process",
  ) =>
    purchaseOrders.find((po) => {
      const supplierMatches = supplierId
        ? po.supplierId === supplierId
        : po.supplierName === supplierName;
      const hasProcessLines = po.items.some(item => item.processStockId != null);
      const hasGarmentLines = po.items.some(item => item.processStockId == null);
      const typeMatches = type === "process"
        ? !hasGarmentLines
        : !hasProcessLines;
      return po.status === "draft" && supplierMatches && typeMatches;
    });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="w-7 h-7 text-primary" /> Purchasing
            </h1>
            <p className="text-muted-foreground mt-1">Manage purchase requirements and supplier orders.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setManualPOOpen(true)}
            >
              <Plus className="w-4 h-4" /> New Manual PO
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={recheckAndRefresh}
              disabled={isRechecking || reqFetching || posFetching}
            >
              <RefreshCw className={`w-4 h-4 ${isRechecking || reqFetching || posFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Tabs defaultValue="requirements">
          <TabsList className="mb-4">
            <TabsTrigger value="requirements" className="gap-2">
              <FileText className="w-4 h-4" /> Draft
              {(totalItems + processShortfallCount + draftPos.length) > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{totalItems + processShortfallCount + draftPos.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Truck className="w-4 h-4" /> Awaiting Delivery
              {orderedCount > 0 && <Badge variant="secondary" className="ml-1 text-xs">{orderedCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="backorders" className="gap-2">
              <ClipboardList className="w-4 h-4" /> Backorders
              {backorders.length > 0 && <Badge className="ml-1 text-xs bg-amber-500 text-white">{backorders.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-2">
              <PackageCheck className="w-4 h-4" /> Completed
              {deliveredCount > 0 && <Badge variant="secondary" className="ml-1 text-xs">{deliveredCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="process_stock" className="gap-2">
              <Boxes className="w-4 h-4" /> Process Stock
            </TabsTrigger>
          </TabsList>

          {/* ── Requirements / Draft Tab ── */}
          <TabsContent value="requirements">
            <div className="space-y-4">
              {(reqFetching && groups.length === 0) ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : draftTilesBySupplier.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <CheckCircle className="w-12 h-12 text-green-400" />
                  <p className="text-lg font-medium">No purchasing required</p>
                  <p className="text-sm">All order items are in stock or fulfilled.</p>
                </div>
              ) : selectedDraftSupplier === null ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {draftTilesBySupplier.map((tile) => {
                    const logoUrl = supplierLogoMap.get(tile.name.toLowerCase());
                    return (
                      <button
                        key={tile.name}
                        onClick={() => setSelectedDraftSupplier(tile.name)}
                        className="flex flex-col items-center gap-3 rounded-xl border border-border bg-white p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all group cursor-pointer"
                      >
                        <div className="w-16 h-16 rounded-xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {logoUrl ? (
                            <UploadedImage src={logoUrl} alt={tile.name} className="h-full w-full object-contain p-1.5" fallback={<FileText className="w-7 h-7 text-muted-foreground/40" />} />
                          ) : (
                            <FileText className="w-7 h-7 text-muted-foreground/40" />
                          )}
                        </div>
                        <div className="text-center space-y-1.5 w-full">
                          <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">{tile.name}</p>
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {(tile.reqLines + tile.psLines) > 0 && (
                              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200">{tile.reqLines + tile.psLines} to order</Badge>
                            )}
                            {tile.poCount > 0 && (
                              <Badge variant="secondary" className="text-xs">{tile.poCount} draft PO{tile.poCount !== 1 ? "s" : ""}</Badge>
                            )}
                          </div>
                          {tile.totalValue != null && (
                            <p className="text-xs text-muted-foreground font-medium">£{tile.totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          )}
                          {tile.totalRevenue != null && tile.totalValue != null && tile.totalRevenue > 0 && (() => {
                            const gp = ((tile.totalRevenue - tile.totalValue) / tile.totalRevenue) * 100;
                            const gpCls = gp >= 65
                              ? "bg-green-100 text-green-800 border-green-200"
                              : gp >= 50
                              ? "bg-amber-100 text-amber-800 border-amber-200"
                              : "bg-red-100 text-red-800 border-red-200";
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${gpCls}`}>
                                <TrendingUp className="w-3 h-3" />{gp.toFixed(1)}% GP
                              </span>
                            );
                          })()}
                          {tile.earliestCreatedAt != null && (() => {
                            const days = Math.floor((Date.now() - new Date(tile.earliestCreatedAt).getTime()) / 86400000);
                            const bg = days >= 7
                              ? "bg-red-100 text-red-800 border-red-200"
                              : days >= 4
                              ? "bg-orange-100 text-orange-800 border-orange-200"
                              : "bg-green-100 text-green-800 border-green-200";
                            const label = days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`;
                            return (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${bg}`}>
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedDraftSupplier(null)}>
                      <ChevronRight className="w-4 h-4 rotate-180" /> All Suppliers
                    </Button>
                    <span className="text-muted-foreground text-sm">/</span>
                    <span className="font-semibold text-sm">{selectedDraftSupplier}</span>
                  </div>

                  {/* Requirements for selected supplier */}
                  {groups.filter(g => g.supplierName === selectedDraftSupplier).map((group) => {
                    const overrides = reqQtyOverrides[group.supplierName] ?? {};
                    const totalQty = group.items.reduce((s, i) => {
                      const cellKey = [i.productName, i.colour ?? "", i.size ?? "", i.supplierCode ?? ""].join("|");
                      return s + (overrides[cellKey] ?? i.purchaseQuantity ?? 0);
                    }, 0);
                    const existingDraft = getDraftPoForSupplier(group.supplierId, group.supplierName, "garment");
                    return (
                      <div key={group.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <div className="font-semibold text-base flex items-center gap-2">
                                {group.supplierName}
                                {group.supplierId === null && (
                                  <span className="text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Set supplier on the product to assign</span>
                                )}
                              </div>
                              {group.supplierEmail && <div className="text-xs text-muted-foreground">{group.supplierEmail}</div>}
                            </div>
                            <Badge variant="secondary">{group.items.length} line{group.items.length !== 1 ? "s" : ""}</Badge>
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{totalQty} units needed</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {existingDraft ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                onClick={() => addToPoMutation.mutate({
                                  poId: existingDraft.id,
                                  itemIds: group.items.filter(i => i.itemId > 0).map(i => i.itemId),
                                  manualReqIds: group.items.filter(i => i.itemId < 0).map(i => -i.itemId),
                                })}
                                disabled={addToPoMutation.isPending}>
                                <Plus className="w-3.5 h-3.5" /> Add to Draft PO ({existingDraft.poNumber})
                              </Button>
                            ) : (
                              <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90" onClick={() => setCreatePoGroup(group)}>
                                <FileText className="w-3.5 h-3.5" /> Create Draft PO
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setAddManualReqOpen(true)}>
                              <Plus className="w-3.5 h-3.5" /> Add Requirement
                            </Button>
                          </div>
                        </div>
                        <div className="border-t border-border px-5 py-4">
                          <ReqMatrixView
                            items={group.items}
                            overrides={overrides}
                            onQtyChange={(cellKey, qty) => setReqQtyOverrides((prev) => ({ ...prev, [group.supplierName]: { ...(prev[group.supplierName] ?? {}), [cellKey]: qty } }))}
                            onDeleteRow={(itemIds) => deleteRequirementMutation.mutate(itemIds)}
                            currency={group.supplierCurrency}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Process material requirements for selected supplier */}
                  {processReqsBySupplier.filter(g => g.supplierName === selectedDraftSupplier).map((psGroup) => {
                    const psOverrides = psQtyOverrides[psGroup.supplierName] ?? {};
                    const totalPsQty = psGroup.items.reduce((s, r) => s + (psOverrides[r.processStockId] ?? r.shortfall), 0);
                    const existingDraft = getDraftPoForSupplier(psGroup.supplierId, psGroup.supplierName, "process");
                    const itemsWithOverrides = psGroup.items
                      .map(r => ({ ...r, shortfall: psOverrides[r.processStockId] ?? r.shortfall }))
                      .filter(r => r.shortfall > 0);
                    return (
                      <div key={`ps-${psGroup.supplierName}`} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="font-semibold text-base">{psGroup.supplierName}</div>
                            <Badge variant="outline" className="text-xs">Process Materials</Badge>
                            <Badge variant="secondary">{psGroup.items.length} line{psGroup.items.length !== 1 ? "s" : ""}</Badge>
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{totalPsQty} units needed</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {existingDraft ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                onClick={() => addProcessStockToPoMutation.mutate({ poId: existingDraft.id, items: itemsWithOverrides })}
                                disabled={addProcessStockToPoMutation.isPending || itemsWithOverrides.length === 0}>
                                <Plus className="w-3.5 h-3.5" /> Add to Draft PO ({existingDraft.poNumber})
                              </Button>
                            ) : (
                              <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90"
                                onClick={() => { setCreateProcessPoGroup({ ...psGroup, items: itemsWithOverrides }); setCreateProcessPoNotes(""); }}
                                disabled={itemsWithOverrides.length === 0}>
                                <FileText className="w-3.5 h-3.5" /> Create Draft PO
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="border-t border-border px-5 py-4">
                          <ProcessMaterialsLineTable
                            items={itemsWithOverrides}
                            overrides={psOverrides}
                            showBookIn={false}
                            onQtyChange={(processStockId, qty) => setPsQtyOverrides((prev) => ({ ...prev, [psGroup.supplierName]: { ...(prev[psGroup.supplierName] ?? {}), [processStockId]: qty } }))}
                            onRemove={(processStockId) => setPsQtyOverrides((prev) => ({ ...prev, [psGroup.supplierName]: { ...(prev[psGroup.supplierName] ?? {}), [processStockId]: 0 } }))}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Draft POs for selected supplier */}
                  {draftPos.filter(po => po.supplierName === selectedDraftSupplier).map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                      onRefresh={() => { refetchPos(); refetchReqs(); }}
                      onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                      onCancelLine={(poId, itemId) => cancelLineMutation.mutate({ poId, itemId })}
                      onCleanup={() => { refetchPos(); refetchReqs(); }}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Purchase Orders Tab ── */}
          <TabsContent value="orders">
            <div className="space-y-4">
              {/* Search bar */}
              {(filteredPos.length > 0 || poSearch) && (
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by PO number, supplier, product…"
                    value={poSearch}
                    onChange={e => { setPoSearch(e.target.value); setSelectedOrdersSupplier(null); }}
                    className="pl-9 pr-8 h-9"
                  />
                  {poSearch && (
                    <button onClick={() => setPoSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              {posFetching && purchaseOrders.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : filteredPos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Truck className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-lg font-medium">No orders awaiting delivery</p>
                  <p className="text-sm">Mark a draft PO as Ordered once you've sent it to the supplier.</p>
                </div>
              ) : poSearch.trim() ? (() => {
                const q = poSearch.trim().toLowerCase();
                const matched = filteredPos.filter(po =>
                  po.poNumber.toLowerCase().includes(q) ||
                  po.supplierName.toLowerCase().includes(q) ||
                  po.items.some(i =>
                    i.productName?.toLowerCase().includes(q) ||
                    i.orderNumber?.toLowerCase().includes(q) ||
                    i.customerName?.toLowerCase().includes(q) ||
                    i.supplierCode?.toLowerCase().includes(q)
                  )
                );
                return matched.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                    <Search className="w-10 h-10 text-muted-foreground/30" />
                    <p className="text-base font-medium">No matching purchase orders</p>
                    <p className="text-sm">Try searching by PO number, supplier, or product name.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{matched.length} PO{matched.length !== 1 ? "s" : ""} found</p>
                    {matched.map((po) => (
                      <POCard
                        key={po.id}
                        po={po}
                        hideMatrix
                        onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                        onDelete={(id) => deleteMutation.mutate(id)}
                        onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                        onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                        onRefresh={() => { refetchPos(); refetchReqs(); }}
                        onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                        onCancelLine={(poId, itemId) => cancelLineMutation.mutate({ poId, itemId })}
                        onCleanup={() => { refetchPos(); refetchReqs(); }}
                      />
                    ))}
                  </div>
                );
              })() : selectedOrdersSupplier === null ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {orderedBySupplier.map(({ name, pos }) => {
                    const logoUrl = supplierLogoMap.get(name.toLowerCase());
                    const overdueCount = pos.filter((po) => {
                      if (!po.estimatedDeliveryDate) return false;
                      return new Date(po.estimatedDeliveryDate) < new Date();
                    }).length;
                    return (
                      <button
                        key={name}
                        onClick={() => setSelectedOrdersSupplier(name)}
                        className="flex flex-col items-center gap-3 rounded-xl border border-border bg-white p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all text-left group cursor-pointer"
                      >
                        <div className="w-16 h-16 rounded-xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {logoUrl ? (
                            <UploadedImage src={logoUrl} alt={name} className="h-full w-full object-contain p-1.5" fallback={<Truck className="w-7 h-7 text-muted-foreground/40" />} />
                          ) : (
                            <Truck className="w-7 h-7 text-muted-foreground/40" />
                          )}
                        </div>
                        <div className="text-center space-y-1 w-full">
                          <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">{name}</p>
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <Badge variant="secondary" className="text-xs">{pos.length} PO{pos.length !== 1 ? "s" : ""}</Badge>
                            {overdueCount > 0 && (
                              <Badge className="text-xs bg-red-100 text-red-700 border-red-200">{overdueCount} overdue</Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedOrdersSupplier(null)}>
                      <ChevronRight className="w-4 h-4 rotate-180" /> All Suppliers
                    </Button>
                    <span className="text-muted-foreground text-sm">/</span>
                    <span className="font-semibold text-sm">{selectedOrdersSupplier}</span>
                  </div>
                  {filteredPos.filter((po) => po.supplierName === selectedOrdersSupplier).map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      hideMatrix
                      onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                      onRefresh={() => { refetchPos(); refetchReqs(); }}
                      onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                      onCancelLine={(poId, itemId) => cancelLineMutation.mutate({ poId, itemId })}
                      onCleanup={() => { refetchPos(); refetchReqs(); }}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Completed Tab ── */}
          <TabsContent value="completed">
            <div className="space-y-4">
              {deliveredCount > 0 && (
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by PO number, supplier, product…"
                    value={completedSearch}
                    onChange={e => { setCompletedSearch(e.target.value); setSelectedCompletedSupplier(null); }}
                    className="pl-9 pr-8 h-9"
                  />
                  {completedSearch && (
                    <button onClick={() => setCompletedSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              {posFetching && purchaseOrders.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : deliveredCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <PackageCheck className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-lg font-medium">No completed deliveries yet</p>
                  <p className="text-sm">Deliveries booked in will appear here once marked as delivered.</p>
                </div>
              ) : completedSearch.trim() ? (() => {
                const q = completedSearch.trim().toLowerCase();
                const matched = purchaseOrders.filter((po) =>
                  po.status === "delivered" && (
                    po.poNumber.toLowerCase().includes(q) ||
                    po.supplierName.toLowerCase().includes(q) ||
                    po.items.some(i =>
                      i.productName?.toLowerCase().includes(q) ||
                      i.orderNumber?.toLowerCase().includes(q) ||
                      i.customerName?.toLowerCase().includes(q) ||
                      i.supplierCode?.toLowerCase().includes(q)
                    )
                  )
                );
                return matched.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                    <Search className="w-10 h-10 text-muted-foreground/30" />
                    <p className="text-base font-medium">No matching purchase orders</p>
                    <p className="text-sm">Try searching by PO number, supplier, or product name.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{matched.length} PO{matched.length !== 1 ? "s" : ""} found</p>
                    {matched.map((po) => (
                      <POCard
                        key={po.id}
                        po={po}
                        onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                        onDelete={(id) => deleteMutation.mutate(id)}
                        onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                        onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                        onRefresh={() => { refetchPos(); refetchReqs(); }}
                        onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                        onCancelLine={(poId, itemId) => cancelLineMutation.mutate({ poId, itemId })}
                        onCleanup={() => { refetchPos(); refetchReqs(); }}
                      />
                    ))}
                  </div>
                );
              })() : selectedCompletedSupplier === null ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {deliveredBySupplier.map(({ name, pos }) => {
                    const logoUrl = supplierLogoMap.get(name.toLowerCase());
                    return (
                      <button
                        key={name}
                        onClick={() => setSelectedCompletedSupplier(name)}
                        className="flex flex-col items-center gap-3 rounded-xl border border-border bg-white p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all text-left group cursor-pointer"
                      >
                        <div className="w-16 h-16 rounded-xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {logoUrl ? (
                            <UploadedImage src={logoUrl} alt={name} className="h-full w-full object-contain p-1.5" fallback={<PackageCheck className="w-7 h-7 text-muted-foreground/40" />} />
                          ) : (
                            <PackageCheck className="w-7 h-7 text-muted-foreground/40" />
                          )}
                        </div>
                        <div className="text-center space-y-1 w-full">
                          <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">{name}</p>
                          <Badge variant="secondary" className="text-xs">{pos.length} PO{pos.length !== 1 ? "s" : ""}</Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedCompletedSupplier(null)}>
                      <ChevronRight className="w-4 h-4 rotate-180" /> All Suppliers
                    </Button>
                    <span className="text-muted-foreground text-sm">/</span>
                    <span className="font-semibold text-sm">{selectedCompletedSupplier}</span>
                  </div>
                  {purchaseOrders.filter((po) => po.status === "delivered" && po.supplierName === selectedCompletedSupplier).map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                      onRefresh={() => { refetchPos(); refetchReqs(); }}
                      onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                      onCancelLine={(poId, itemId) => cancelLineMutation.mutate({ poId, itemId })}
                      onCleanup={() => { refetchPos(); refetchReqs(); }}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Backorders Tab ── */}
          <TabsContent value="backorders">
            {backorders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <CheckCircle className="w-12 h-12 text-green-400" />
                <p className="text-lg font-medium">No backorders</p>
                <p className="text-sm">PO lines with outstanding quantities after 5 days will appear here.</p>
              </div>
            ) : selectedBackordersSupplier === null ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {backordersBySupplier.map(({ name, lines }) => {
                  const logoUrl = supplierLogoMap.get(name.toLowerCase());
                  const maxOverdue = Math.max(...lines.map(l => l.daysOverdue ?? 0));
                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedBackordersSupplier(name)}
                      className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-amber-400 transition-all group cursor-pointer"
                    >
                      <div className="w-16 h-16 rounded-xl border border-border bg-muted/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {logoUrl ? (
                          <UploadedImage src={logoUrl} alt={name} className="h-full w-full object-contain p-1.5" fallback={<ClipboardList className="w-7 h-7 text-muted-foreground/40" />} />
                        ) : (
                          <ClipboardList className="w-7 h-7 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="text-center space-y-1.5 w-full">
                        <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">{name}</p>
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <Badge variant="secondary" className="text-xs">{lines.length} line{lines.length !== 1 ? "s" : ""}</Badge>
                          {maxOverdue > 0 && (
                            <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">{maxOverdue}d overdue</Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedBackordersSupplier(null)}>
                    <ChevronRight className="w-4 h-4 rotate-180" /> All Suppliers
                  </Button>
                  <span className="text-muted-foreground text-sm">/</span>
                  <span className="font-semibold text-sm">{selectedBackordersSupplier}</span>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-amber-500" />
                  {backorders.filter(b => b.supplierName === selectedBackordersSupplier).length} line{backorders.filter(b => b.supplierName === selectedBackordersSupplier).length !== 1 ? "s" : ""} overdue
                </p>
                {backorders.filter(b => b.supplierName === selectedBackordersSupplier).map((b) => (
                  <div key={b.id} className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-0.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {b.supplierCode && <span className="font-bold text-sm font-mono text-primary">{b.supplierCode}</span>}
                          <span className="font-medium text-sm">{b.productName}</span>
                          {(b.colour || b.size) && (
                            <span className="text-xs text-muted-foreground">{[b.colour, b.size].filter(Boolean).join(" / ")}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          <span>PO: <span className="font-mono font-medium text-foreground">{b.poNumber}</span></span>
                          {b.orderNumber && (
                            <span>Order: <span className="font-mono font-medium text-foreground">{b.orderNumber}</span></span>
                          )}
                          {b.customerName && <span>{b.customerName}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 text-right flex-shrink-0">
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {b.daysOverdue != null && b.daysOverdue > 0 && (
                            <Badge className="bg-red-100 text-red-800 border border-red-300 text-xs font-semibold">
                              {b.daysOverdue} day{b.daysOverdue !== 1 ? "s" : ""} overdue
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{b.remaining} remaining</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            value={backorderDrafts[b.id] ?? b.remaining}
                            onChange={(e) => setBackorderDrafts(prev => ({ ...prev, [b.id]: e.target.value }))}
                            className="h-7 w-14 rounded border border-input bg-background px-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                            disabled={bookInBackorderMutation.isPending || undoBookInMutation.isPending}
                            onClick={() => {
                              const qty = parseInt(String(backorderDrafts[b.id] ?? b.remaining), 10);
                              if (!qty || qty < 1) return;
                              bookInBackorderMutation.mutate({ poId: b.poId, itemId: b.id, quantity: qty, remaining: b.remaining });
                            }}
                          >
                            <PackageCheck className="w-3 h-3" /> Book In
                          </Button>
                        </div>
                        {b.quantityDelivered > 0 && (
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-xs text-muted-foreground">{b.quantityDelivered} already received</span>
                            <button
                              className="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 disabled:opacity-50"
                              disabled={undoBookInMutation.isPending}
                              onClick={() => undoBookInMutation.mutate({ poId: b.poId, itemId: b.id })}
                            >
                              Undo
                            </button>
                          </div>
                        )}
                        {b.estimatedDueDate && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            Due {new Date(b.estimatedDueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                        {b.requiredDate && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Order req. {new Date(b.requiredDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 gap-1 mt-1"
                          onClick={() => openCancelReorder(b)}
                        >
                          <Ban className="w-3 h-3" /> Cancel &amp; Reorder
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Process Stock Tab ── */}
          <TabsContent value="process_stock">
            <ProcessStockTab />
          </TabsContent>
        </Tabs>

        {/* ── Cancel & Reorder dialog ── */}
        {cancelReorderDialog && (
          <Dialog open onOpenChange={() => setCancelReorderDialog(null)}>
            <DialogContent className="max-w-lg flex flex-col max-h-[90vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-center gap-2 text-red-700">
                  <Ban className="w-5 h-5" /> Cancel Backorder &amp; Re-Queue for Reorder
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2 min-h-0 overflow-y-auto flex-1 text-sm">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                  <div className="font-semibold text-sm">{cancelReorderDialog.productName}
                    {(cancelReorderDialog.colour || cancelReorderDialog.size) && (
                      <span className="font-normal text-muted-foreground ml-2">{[cancelReorderDialog.colour, cancelReorderDialog.size].filter(Boolean).join(" / ")}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                    <span>PO: <span className="font-mono font-medium text-foreground">{cancelReorderDialog.poNumber}</span></span>
                    <span>Supplier: <span className="font-medium text-foreground">{cancelReorderDialog.supplierName}</span></span>
                    <span>Cancelling: <span className="font-semibold text-red-700">{cancelReorderDialog.remaining} units</span></span>
                  </div>
                  {cancelReorderDialog.secondarySupplierName && (
                    <div className="text-xs text-blue-700 flex items-center gap-1 pt-0.5">
                      <ArrowRight className="w-3 h-3" />
                      Will re-queue for <span className="font-semibold">{cancelReorderDialog.secondarySupplierName}</span>
                    </div>
                  )}
                  {!cancelReorderDialog.secondarySupplierName && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 pt-0.5">
                      <ArrowRight className="w-3 h-3" />
                      Items will appear in purchasing requirements — select a supplier when creating the new PO.
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  This will write off the outstanding quantity from {cancelReorderDialog.supplierName} and restore the items to the purchasing queue so you can raise a new PO with a different supplier.
                </p>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-foreground">Cancellation email (optional — edit or clear before sending)</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">To</Label>
                    <Input
                      value={cancelEmailTo}
                      onChange={e => setCancelEmailTo(e.target.value)}
                      placeholder="supplier@example.com"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Subject</Label>
                    <Input
                      value={cancelEmailSubject}
                      onChange={e => setCancelEmailSubject(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Message</Label>
                    <Textarea
                      value={cancelEmailBody}
                      onChange={e => setCancelEmailBody(e.target.value)}
                      rows={10}
                      className="text-sm font-mono resize-none"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="shrink-0 gap-2 flex-col sm:flex-row">
                <Button variant="outline" onClick={() => setCancelReorderDialog(null)}>Keep Backorder</Button>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  disabled={cancelAndReorderMutation.isPending}
                  onClick={() => cancelAndReorderMutation.mutate({
                    poId: cancelReorderDialog.poId,
                    itemId: cancelReorderDialog.id,
                    emailTo: "",
                    emailSubject: "",
                    emailBody: "",
                  })}
                >
                  <Ban className="w-4 h-4 mr-1" /> Cancel Only (no email)
                </Button>
                <Button
                  className="bg-red-700 hover:bg-red-800 text-white gap-1"
                  disabled={cancelAndReorderMutation.isPending || !cancelEmailTo}
                  onClick={() => cancelAndReorderMutation.mutate({
                    poId: cancelReorderDialog.poId,
                    itemId: cancelReorderDialog.id,
                    emailTo: cancelEmailTo,
                    emailSubject: cancelEmailSubject,
                    emailBody: cancelEmailBody,
                  })}
                >
                  {cancelAndReorderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Send Email &amp; Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Create Process Material PO dialog ── */}
        {createProcessPoGroup && (
          <Dialog open={!!createProcessPoGroup} onOpenChange={() => setCreateProcessPoGroup(null)}>
            <DialogContent className="max-w-md flex flex-col max-h-[90vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Create Draft PO — {createProcessPoGroup.supplierName}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2 min-h-0 overflow-y-auto flex-1">
                <div className="rounded-lg border border-border divide-y text-sm">
                  {createProcessPoGroup.items.map((req) => (
                    <div key={req.processStockId} className="flex justify-between px-3 py-2">
                      <span className="font-medium">{req.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap pl-4">
                        {req.sku && <span className="font-mono mr-2 text-xs">{req.sku}</span>}
                        <strong>× {req.shortfall}</strong>
                      </span>
                    </div>
                  ))}
                </div>
                {createProcessPoGroup.items.some((r) => r.fileUrl) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                    <Paperclip className="w-3.5 h-3.5" />
                    Print file(s) will be attached to this PO automatically.
                  </p>
                )}
                <div className="space-y-1.5 shrink-0">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea placeholder="Any notes for this purchase order..." value={createProcessPoNotes} onChange={(e) => setCreateProcessPoNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter className="shrink-0">
                <Button variant="outline" onClick={() => setCreateProcessPoGroup(null)}>Cancel</Button>
                <Button
                  onClick={() => createProcessPoMutation.mutate({
                    supplierId: createProcessPoGroup.supplierId,
                    supplierName: createProcessPoGroup.supplierName,
                    notes: createProcessPoNotes || null,
                    items: createProcessPoGroup.items.map((req) => ({
                      processStockId: req.processStockId,
                      quantityOrdered: req.shortfall,
                    })),
                  })}
                  disabled={createProcessPoMutation.isPending}
                  className="gap-1.5"
                >
                  {createProcessPoMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><FileText className="w-4 h-4" />Create Draft PO</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Create PO dialog ── */}
        {createPoGroup && (
          <Dialog open={!!createPoGroup} onOpenChange={() => setCreatePoGroup(null)}>
            <DialogContent className="max-w-md flex flex-col max-h-[90vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Create Draft PO — {createPoGroup.supplierName}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2 min-h-0 overflow-y-auto flex-1">
                <div className="rounded-lg border border-border divide-y text-sm">
                  {(() => {
                    const overrides = reqQtyOverrides[createPoGroup.supplierName] ?? {};
                    const keys: string[] = [];
                    const grps = new Map<string, typeof createPoGroup.items>();
                    for (const item of createPoGroup.items) {
                      const k = [item.productName, item.colour ?? "", item.size ?? "", item.supplierCode ?? ""].join("|");
                      if (!grps.has(k)) { keys.push(k); grps.set(k, []); }
                      grps.get(k)!.push(item);
                    }
                    return keys.map((k) => {
                      const g = grps.get(k)!;
                      const first = g[0];
                      const baseQty = g.reduce((s, i) => s + (i.purchaseQuantity ?? 1), 0);
                      const qty = overrides[k] ?? baseQty;
                      return (
                        <div key={k} className="flex justify-between px-3 py-2">
                          <span className="font-medium">{productDisplayName(first)}</span>
                          <span className="text-muted-foreground whitespace-nowrap pl-4">
                            {[first.colour, first.size].filter(Boolean).join(" / ")} <strong>× {qty}</strong>
                            {overrides[k] !== undefined && overrides[k] !== baseQty && (
                              <span className="ml-1 text-xs text-amber-600">(edited)</span>
                            )}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="space-y-1.5 shrink-0">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea placeholder="Any notes for this purchase order..." value={createPoNotes} onChange={(e) => setCreatePoNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter className="shrink-0">
                <Button variant="outline" onClick={() => setCreatePoGroup(null)}>Cancel</Button>
                <Button
                  onClick={() => createPoMutation.mutate({
                    supplierId: createPoGroup.supplierId,
                    supplierName: createPoGroup.supplierName,
                    supplierEmail: createPoGroup.supplierEmail,
                    notes: createPoNotes || null,
                    itemIds: createPoGroup.items.filter((i) => i.itemId > 0 && i.orderNumber !== null).map((i) => i.itemId),
                    qtyOverrides: reqQtyOverrides[createPoGroup.supplierName] ?? {},
                  })}
                  disabled={createPoMutation.isPending}
                  className="gap-1.5"
                >
                  {createPoMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><FileText className="w-4 h-4" />Create Draft PO</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {emailGroup && (
          <EmailDialog group={emailGroup} open={!!emailGroup} onClose={() => setEmailGroup(null)} onSent={(_ids) => { setEmailGroup(null); queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] }); }} />
        )}

        <ManualPODialog
          open={manualPOOpen}
          onClose={() => setManualPOOpen(false)}
          onCreated={() => { refetchPos(); refetchReqs(); }}
          allSuppliers={allSuppliers}
        />

        {/* ── What's Next dialog — shown after receiving a PO ── */}
        <Dialog open={!!nextStepData} onOpenChange={(open) => { if (!open) setNextStepData(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                Delivery received — what's next?
              </DialogTitle>
            </DialogHeader>
            {nextStepData && (
              <div className="space-y-4 py-1">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                    <ListChecks className="w-4 h-4 flex-shrink-0" />
                    {nextStepData.pickingItems} item{nextStepData.pickingItems !== 1 ? "s" : ""} added to the Picking List
                    {nextStepData.ordersAffected > 1 && (
                      <span className="text-blue-600 font-normal">across {nextStepData.ordersAffected} orders</span>
                    )}
                  </div>
                  {nextStepData.summary.length > 0 && (
                    <ul className="space-y-1">
                      {nextStepData.summary.map((row) => (
                        <li key={row.orderId} className="flex items-start gap-2 text-sm text-blue-900">
                          <span className="text-blue-400 mt-0.5">·</span>
                          <span>
                            <span className="font-mono font-semibold">{row.orderNumber}</span>
                            {row.customerName && <span className="text-blue-700"> — {row.customerName}</span>}
                            <span className="text-blue-600 text-xs ml-1">({row.pickingCount} item{row.pickingCount !== 1 ? "s" : ""})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {nextStepData.summary.some((r) => r.worksheetCount > 0 || r.pickingCount > 0) && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    Items with embroidery or print finishes will automatically create production worksheets when picked.
                  </p>
                )}
              </div>
            )}
            <DialogFooter className="gap-2 flex-col sm:flex-row">
              <Button variant="outline" onClick={() => setNextStepData(null)}>
                Stay here
              </Button>
              <Button
                className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => {
                  const ids = nextStepData?.summary.map(r => r.orderId).join(",") ?? "";
                  setNextStepData(null);
                  navigate(`/production?tab=picking_list${ids ? `&highlight=${ids}` : ""}`);
                }}
              >
                <ListChecks className="w-4 h-4" />
                Go to Picking List
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      <AddManualReqDialog
        open={addManualReqOpen}
        onClose={() => setAddManualReqOpen(false)}
        onAdded={() => { queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] }); }}
      />
      </div>
    </Layout>
  );
}
