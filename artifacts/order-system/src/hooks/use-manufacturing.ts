import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffAuthHeader } from "@/lib/staff-auth";

export type Component = {
  id: number; sku: string; name: string; type: string; supplierId: number | null;
  supplierSku: string | null; unitCost: number | string | null; binLocation: string | null;
  reorderLevel: number; targetStock: number; leadDays: number; isActive: boolean;
  physicalQty: number | null;
};
export type Movement = { id: number; delta: number; reason: string; actor: string; createdAt: string; balanceAfter: number; reference: string | null; note: string | null };
export type Stocktake = { id: number; componentId: number; expectedQty: number; countedQty: number; status: string; createdAt: string; createdBy: string; approvedAt: string | null; approvedBy: string | null; note: string | null };
export type InventoryClassification = "LEGACY_REVIEW" | "FINISHED_STOCK" | "COMPONENT_STOCK";
export type Variant = { id: number; sku?: string | null; colour?: string | null; size?: string | null; sleeve?: string | null; inventoryClassification?: InventoryClassification | null; stockQuantity?: number };
export type Bom = { id: number; version: number; variantId: number; isCurrent: boolean; createdAt?: string; componentLines: { componentId: number; quantity: number; componentSkuSnapshot?: string | null; componentNameSnapshot?: string | null; unitCostGbpSnapshot?: number | string | null }[]; operationLines: { method: string; designRef: string; position: string; instructions: string; labourAllowance: number }[] };
export type Supplier = { id: number; name: string };
type RawComponent = Omit<Component, "unitCost" | "binLocation" | "targetStock" | "isActive" | "physicalQty"> & { costGbp: number; bin: string | null; targetLevel: number; active: boolean; physicalBalance: number };
type RawMovement = Omit<Movement, "delta" | "balanceAfter" | "createdAt"> & { quantityChange: number; resultingBalance: number; occurredAt: string };
type RawStocktake = Omit<Stocktake, "expectedQty" | "countedQty"> & { expectedQuantity: number; countedQuantity: number };
function toStocktake(row: RawStocktake): Stocktake {
  return { ...row, expectedQty: row.expectedQuantity, countedQty: row.countedQuantity };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...staffAuthHeader(), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || body?.message || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

// The staff endpoints may return a bare array or a named collection.
function collection<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const result = (value as Record<string, unknown>)[key];
    if (Array.isArray(result)) return result as T[];
  }
  throw new Error(`Unexpected ${key} response from server`);
}

export function useComponents() {
  return useQuery({ queryKey: ["manufacturing", "components"], queryFn: async () => collection<RawComponent>(await request("/manufacturing/components"), "components").map(c => ({ ...c, unitCost: c.costGbp, binLocation: c.bin, targetStock: c.targetLevel, isActive: c.active, physicalQty: c.physicalBalance })) });
}
export function useSuppliers() {
  return useQuery({ queryKey: ["manufacturing", "suppliers"], queryFn: async () => collection<Supplier>(await request("/suppliers"), "suppliers") });
}
export function useMovements(id: number | null) {
  return useQuery({ queryKey: ["manufacturing", "movements", id], enabled: id !== null, queryFn: async () => collection<RawMovement>(await request(`/manufacturing/components/${id}/movements`), "movements").map(m => ({ ...m, delta: m.quantityChange, balanceAfter: m.resultingBalance, createdAt: m.occurredAt })) });
}
export function useStocktakes(id: number | null) {
  return useQuery({ queryKey: ["manufacturing", "stocktakes", id], enabled: id !== null, queryFn: async () => collection<RawStocktake>(await request(`/manufacturing/components/${id}/stocktakes`), "stocktakes").map(toStocktake) });
}
export function useVariants(productId: number) {
  return useQuery({ queryKey: ["manufacturing", "variants", productId], enabled: Number.isFinite(productId), queryFn: async () => collection<Variant>(await request(`/products/${productId}/variants`), "variants") });
}
export function useClassifyVariant(productId: number) {
  return useWrite<{ variantId: number; classification: InventoryClassification }>(
    v => `/manufacturing/variants/${v.variantId}/classification`, "PATCH",
    [["manufacturing", "variants", productId]],
    v => ({ classification: v.classification }),
  );
}
export function useBoms(variantId: number | null) {
  return useQuery({ queryKey: ["manufacturing", "boms", variantId], enabled: variantId !== null, queryFn: async () => collection<Bom & { components: Bom["componentLines"]; operations: Bom["operationLines"] }>(await request(`/manufacturing/variants/${variantId}/boms`), "boms").map(b => ({ ...b, componentLines: b.components, operationLines: b.operations })) });
}
function useWrite<T>(path: (payload: T) => string, method: "POST" | "PATCH", keys: unknown[][], body: (payload: T) => unknown = v => v) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: T) => request(path(payload), { method, body: JSON.stringify(body(payload)) }),
    onSuccess: () => Promise.all(keys.map(key => qc.invalidateQueries({ queryKey: key }))),
  });
}
export function useCreateComponent() {
  return useWrite<Partial<Component>>(() => "/manufacturing/components", "POST", [["manufacturing", "components"]], componentBody);
}
export function useUpdateComponent() {
  return useWrite<Partial<Component> & { id: number }>(v => `/manufacturing/components/${v.id}`, "PATCH", [["manufacturing", "components"]], componentBody);
}
function componentBody(v: Partial<Component>) {
  return { sku: v.sku, name: v.name, type: v.type, supplierId: v.supplierId, supplierSku: v.supplierSku,
    costGbp: v.unitCost, bin: v.binLocation, reorderLevel: v.reorderLevel, targetLevel: v.targetStock,
    leadDays: v.leadDays, active: v.isActive };
}
export function useOpeningBalance() {
  return useWrite<{ componentId: number; quantity: number; note: string }>(v => `/manufacturing/components/${v.componentId}/opening-balance`, "POST", [["manufacturing", "components"], ["manufacturing", "movements"]], v => ({ countedQuantity: v.quantity, note: v.note }));
}
export function useCreateStocktake() {
  return useWrite<{ componentId: number; countedQty: number; note: string }>(v => `/manufacturing/components/${v.componentId}/stocktakes`, "POST", [["manufacturing", "components"], ["manufacturing", "movements"], ["manufacturing", "stocktakes"]], v => ({ countedQuantity: v.countedQty, note: v.note }));
}
export function useApproveStocktake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request(`/manufacturing/stocktakes/${id}/approve`, { method: "POST" }),
    onSuccess: () => Promise.all([["manufacturing", "components"], ["manufacturing", "movements"], ["manufacturing", "stocktakes"]].map(queryKey => qc.invalidateQueries({ queryKey }))),
  });
}
export function useCreateBom(variantId: number | null) {
  return useWrite<{ componentLines: Bom["componentLines"]; operationLines: Bom["operationLines"] }>(() => `/manufacturing/variants/${variantId}/boms`, "POST", [["manufacturing", "boms", variantId]], v => ({ components: v.componentLines.map(({ componentId, quantity }) => ({ componentId, quantity })), operations: v.operationLines.map((op, i) => ({ ...op, sortOrder: i })) }));
}