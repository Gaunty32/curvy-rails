import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffAuthHeader } from "@/lib/staff-auth";
import {
  useGetManufacturingComponentBalances, getGetManufacturingComponentBalancesQueryKey,
  useGetManufacturingOrderReadiness, getGetManufacturingOrderReadinessQueryKey,
  useUpdateManufacturingVariantAvailabilityPolicy,
} from "@workspace/api-client-react";

export type Component = {
  id: number; sku: string; name: string; type: string; supplierId: number | null;
  supplierSku: string | null; unitCost: number | string | null; binLocation: string | null;
  reorderLevel: number; targetStock: number; leadDays: number; isActive: boolean;
  physicalQty: number | null; replenishable: boolean;
};
export type Movement = { id: number; delta: number; reason: string; actor: string; createdAt: string; balanceAfter: number; reference: string | null; note: string | null };
export type Stocktake = { id: number; componentId: number; expectedQty: number; countedQty: number; status: string; createdAt: string; createdBy: string; approvedAt: string | null; approvedBy: string | null; note: string | null };
export type InventoryClassification = "LEGACY_REVIEW" | "FINISHED_STOCK" | "COMPONENT_STOCK";
export type Variant = { id: number; sku?: string | null; colour?: string | null; size?: string | null; sleeve?: string | null; inventoryClassification?: InventoryClassification | null; stockQuantity?: number; manufacturingEnabled?: boolean; allowOrderToReplenish?: boolean; maxOutstandingReplenishmentUnits?: number; promisedReplenishmentDays?: number };
export type Bom = { id: number; version: number; variantId: number; isCurrent: boolean; createdAt?: string; componentLines: { componentId: number; quantity: number; componentSkuSnapshot?: string | null; componentNameSnapshot?: string | null; unitCostGbpSnapshot?: number | string | null }[]; operationLines: { method: string; designRef: string; position: string; instructions: string; labourAllowance: number }[] };
export type Supplier = { id: number; name: string };
export type AvailabilityConsumer = { id: number | string; quantity: number; reference: string | null; orderId?: number | null; expiresAt?: string | null };
export type ComponentAvailability = {
  componentId: number; physical: number; activeHolds: number; confirmedAllocations: number; available: number;
  holds: AvailabilityConsumer[]; allocations: AvailabilityConsumer[];
};
export type Requirement = { componentId: number; componentSku: string | null; componentName: string; required: number; allocated: number; shortfall: number; status: "CONFIRMED" | "RELEASED"; manualReviewRequired: boolean; manualReviewReason: string | null };
export type ReadinessItem = { orderItemId: number; status: "FULLY_ALLOCATED" | "PARTIALLY_ALLOCATED" | "WAITING_FOR_COMPONENTS"; manualReviewRequired: boolean; components: Requirement[] };
export type OrderReadiness = { orderId: number; status: "FULLY_ALLOCATED" | "PARTIALLY_ALLOCATED" | "WAITING_FOR_COMPONENTS"; manualReviewRequired: boolean; items: ReadinessItem[] };
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
export function useComponentAvailability(id: number | null) {
  const query = useGetManufacturingComponentBalances(id ?? 0, {
    query: { enabled: id !== null, queryKey: getGetManufacturingComponentBalancesQueryKey(id ?? 0), refetchInterval: 30_000 },
    request: { headers: staffAuthHeader(), credentials: "include" },
  });
  return { ...query, data: query.data && ({
    componentId: query.data.componentId, physical: query.data.physical, activeHolds: query.data.held,
    confirmedAllocations: query.data.allocated, available: query.data.available,
    holds: query.data.holds.map(h => ({ id: h.id, quantity: h.heldQuantity, reference: h.paymentIntentId, expiresAt: h.expiresAt })),
    allocations: query.data.allocations.map(a => ({ id: a.id, quantity: a.allocatedQuantity, reference: `Order #${a.orderId} · line #${a.orderItemId}`, orderId: a.orderId })),
  } satisfies ComponentAvailability) };
}
export function useOrderReadiness(id: number) {
  const query = useGetManufacturingOrderReadiness(id, {
    query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetManufacturingOrderReadinessQueryKey(id), refetchInterval: 30_000 },
    request: { headers: staffAuthHeader(), credentials: "include" },
  });
  return { ...query, data: query.data && ({
    orderId: query.data.orderId, status: query.data.readiness, manualReviewRequired: query.data.manualReviewRequired,
    items: query.data.items.map(item => ({
      orderItemId: item.orderItemId, status: item.readiness, manualReviewRequired: item.manualReviewRequired,
      components: item.components.map(c => ({
        componentId: c.componentId, componentSku: c.sku, componentName: c.name,
        required: c.required, allocated: c.allocated, shortfall: c.shortfall,
        status: c.status, manualReviewRequired: c.manualReviewRequired, manualReviewReason: c.manualReviewReason,
      })),
    })),
  } satisfies OrderReadiness) };
}
export function useSaveVariantAvailabilityPolicy(productId: number, variantId: number | null) {
  const qc = useQueryClient();
  return useUpdateManufacturingVariantAvailabilityPolicy({
    request: { headers: staffAuthHeader(), credentials: "include" },
    mutation: { onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ["manufacturing", "variants", productId] }),
      qc.invalidateQueries({ queryKey: ["manufacturing", "boms", variantId] }),
    ]) },
  });
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
    onSuccess: () => Promise.all([
      ...keys.map(key => qc.invalidateQueries({ queryKey: key })),
      qc.invalidateQueries({ predicate: query => {
        const key = query.queryKey[0];
        return typeof key === "string" && (key.endsWith("/balances") || key.endsWith("/readiness"));
      } }),
    ]),
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
    leadDays: v.leadDays, active: v.isActive, replenishable: v.replenishable };
}
export function useOpeningBalance() {
  return useWrite<{ componentId: number; quantity: number; note: string }>(v => `/manufacturing/components/${v.componentId}/opening-balance`, "POST", [["manufacturing", "components"], ["manufacturing", "movements"], ["/api/manufacturing/components"]], v => ({ countedQuantity: v.quantity, note: v.note }));
}
export function useCreateStocktake() {
  return useWrite<{ componentId: number; countedQty: number; note: string }>(v => `/manufacturing/components/${v.componentId}/stocktakes`, "POST", [["manufacturing", "components"], ["manufacturing", "movements"], ["manufacturing", "stocktakes"], ["/api/manufacturing/components"]], v => ({ countedQuantity: v.countedQty, note: v.note }));
}
export function useApproveStocktake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request(`/manufacturing/stocktakes/${id}/approve`, { method: "POST" }),
    onSuccess: () => Promise.all([
      ...[["manufacturing", "components"], ["manufacturing", "movements"], ["manufacturing", "stocktakes"]].map(queryKey => qc.invalidateQueries({ queryKey })),
      qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].endsWith("/balances") }),
    ]),
  });
}
export function useCreateBom(variantId: number | null) {
  return useWrite<{ componentLines: Bom["componentLines"]; operationLines: Bom["operationLines"] }>(() => `/manufacturing/variants/${variantId}/boms`, "POST", [["manufacturing", "boms", variantId]], v => ({ components: v.componentLines.map(({ componentId, quantity }) => ({ componentId, quantity })), operations: v.operationLines.map((op, i) => ({ ...op, sortOrder: i })) }));
}