import { and, eq, inArray, sql } from "drizzle-orm";
import {
  manufacturingAllocationsTable, manufacturingAvailabilityPoliciesTable,
  manufacturingBomsTable, manufacturingBomComponentsTable,
  manufacturingCheckoutHoldsTable, manufacturingComponentsTable,
  productVariantsTable,
  manufacturingMovementsTable,
} from "@workspace/db/schema";

type Database = any;
export type CheckoutLine = { variantId: number; quantity: number; lineIndex: number };
export type AllocationItemMap = Record<number, number> | Map<number, number> | ((lineIndex: number) => number | undefined);

function httpError(message: string, status: number, details: Record<string, unknown> = {}): Error & { status: number } {
  return Object.assign(new Error(message), { status, ...details });
}

async function activePolicy(tx: Database) {
  const [policy] = await tx.select().from(manufacturingAvailabilityPoliciesTable)
    .where(eq(manufacturingAvailabilityPoliciesTable.id, 1));
  return policy ?? { lowStockThreshold: 3, holdDurationMinutes: 20 };
}

async function lockComponents(tx: Database, componentIds: number[]): Promise<void> {
  const ids = [...new Set(componentIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  // All callers lock the complete component set in ascending PK order before
  // reading any balances, preventing shared-component checkout races/deadlocks.
  await tx.execute(sql`
    SELECT id FROM manufacturing_components
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id FOR UPDATE
  `);
}

async function lockPaymentIntent(tx: Database, intentId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${intentId}, 0))`);
}

async function lockProductVariantActivation(tx: Database, variantId: number): Promise<number> {
  const [variant] = await tx.select({ productId: productVariantsTable.productId })
    .from(productVariantsTable).where(eq(productVariantsTable.id, variantId));
  if (!variant) throw httpError("Sellable variant not found.", 404);
  // Serialize manufacturing activation per product before locking individual
  // variants, so two sibling activations cannot deadlock or both pass.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"manufacturing-activation:" + variant.productId}, 0))`);
  return variant.productId;
}

function normalizedAttributeValue(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function legacyVariantSelectionKey(variant: {
  colour: unknown; size: unknown; sleeve: unknown;
}): string {
  return JSON.stringify([
    normalizedAttributeValue(variant.colour),
    normalizedAttributeValue(variant.size),
    normalizedAttributeValue(variant.sleeve),
  ]);
}

function customerVariantSelectionKey(variant: {
  colour: unknown;
  size: unknown;
  sleeve: unknown;
  variantAttributes: unknown;
}): string {
  const variantAttributes = Array.isArray(variant.variantAttributes)
    ? variant.variantAttributes.map((attribute: any) => [
      normalizedAttributeValue(attribute?.name),
      normalizedAttributeValue(attribute?.option),
    ]).sort((a: string[], b: string[]) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    : [];
  return JSON.stringify([legacyVariantSelectionKey(variant), variantAttributes]);
}

async function balances(tx: Database, ids: number[]) {
  if (!ids.length) return new Map<number, { physical: number; held: number; allocated: number; available: number }>();
  const result = await tx.execute(sql`
    SELECT c.id,
      c.physical_balance AS physical,
      COALESCE((SELECT sum(h.held_quantity) FROM manufacturing_checkout_holds h
        WHERE h.component_id = c.id AND h.status = 'ACTIVE' AND h.expires_at > now()), 0)::int AS held,
      COALESCE((SELECT sum(a.allocated_quantity) FROM manufacturing_confirmed_allocations a
        WHERE a.component_id = c.id AND a.status = 'CONFIRMED'), 0)::int AS allocated
    FROM manufacturing_components c
    WHERE c.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY c.id
  `);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? result;
  return new Map((rows as Array<Record<string, unknown>>).map((row) => {
    const physical = Number(row.physical);
    const held = Number(row.held);
    const allocated = Number(row.allocated);
    return [Number(row.id), { physical, held, allocated, available: physical - held - allocated }];
  }));
}

async function currentBom(tx: Database, variantId: number) {
  const [bom] = await tx.select().from(manufacturingBomsTable).where(and(
    eq(manufacturingBomsTable.variantId, variantId),
    eq(manufacturingBomsTable.isCurrent, true),
  ));
  if (!bom) return null;
  const components = await tx.select().from(manufacturingBomComponentsTable)
    .where(eq(manufacturingBomComponentsTable.bomId, bom.id));
  return { ...bom, components };
}

function mapItem(items: AllocationItemMap, lineIndex: number): number | undefined {
  if (typeof items === "function") return items(lineIndex);
  return items instanceof Map ? items.get(lineIndex) : items[lineIndex];
}

async function outstandingReplenishmentUnits(tx: Database, variantId: number): Promise<number> {
  const holds = await tx.execute(sql`
    SELECT COALESCE(sum(units), 0)::int AS units FROM (
      SELECT max(ceil(h.shortfall_quantity::numeric / bc.quantity)) AS units
      FROM manufacturing_checkout_holds h
      JOIN manufacturing_bom_components bc
        ON bc.bom_id = h.bom_id AND bc.component_id = h.component_id
      WHERE h.variant_id = ${variantId} AND h.status = 'ACTIVE' AND h.expires_at > now()
      GROUP BY h.payment_intent_id, h.line_index
    ) outstanding
  `);
  const allocations = await tx.execute(sql`
    SELECT COALESCE(sum(units), 0)::int AS units FROM (
      SELECT max(ceil(a.shortfall_quantity::numeric / bc.quantity)) AS units
      FROM manufacturing_confirmed_allocations a
      JOIN manufacturing_bom_components bc
        ON bc.bom_id = a.bom_id AND bc.component_id = a.component_id
      WHERE a.variant_id = ${variantId} AND a.status = 'CONFIRMED'
      GROUP BY a.order_id, a.order_item_id
    ) outstanding
  `);
  const rows = (value: any) => value?.rows ?? value;
  return Number(rows(holds)[0]?.units ?? 0) + Number(rows(allocations)[0]?.units ?? 0);
}

async function assertManufacturingCanBeEnabled(tx: Database, variantId: number, productId: number): Promise<void> {
  const siblingVariants = await tx.select({
    id: productVariantsTable.id,
    colour: productVariantsTable.colour,
    size: productVariantsTable.size,
    sleeve: productVariantsTable.sleeve,
    variantAttributes: productVariantsTable.variantAttributes,
  }).from(productVariantsTable)
    .where(eq(productVariantsTable.productId, productId))
    .orderBy(productVariantsTable.id)
    .for("update");
  const target = siblingVariants.find((variant: any) => variant.id === variantId);
  const ambiguousSibling = siblingVariants.find((variant: any) => variant.id !== variantId
    && target
    && (customerVariantSelectionKey(variant) === customerVariantSelectionKey(target)
      // The existing shop catalogue/checkout selector deduplicates by these
      // legacy fields and does not expose variantAttributes separately.
      || legacyVariantSelectionKey(variant) === legacyVariantSelectionKey(target)));
  if (ambiguousSibling) {
    throw httpError(
      "Cannot enable manufacturing: a sibling variant has the same customer-selectable attributes, and current checkout cannot distinguish the variants.",
      409,
    );
  }
  const bom = await currentBom(tx, variantId);
  if (!bom) throw httpError("A current BOM is required before enabling manufacturing availability.", 409);
  if (!bom.components.length) throw httpError("The current BOM must include physical components.", 409);
  const componentIds = bom.components.map((line: any) => line.componentId);
  const activeComponents = await tx.select({ id: manufacturingComponentsTable.id, active: manufacturingComponentsTable.active })
    .from(manufacturingComponentsTable).where(inArray(manufacturingComponentsTable.id, componentIds));
  if (activeComponents.length !== componentIds.length || activeComponents.some((component: any) => !component.active)) {
    throw httpError("Every current BOM component must remain active before enabling manufacturing availability.", 409);
  }
  const opened = await tx.select({ componentId: manufacturingMovementsTable.componentId })
    .from(manufacturingMovementsTable)
    .where(and(
      inArray(manufacturingMovementsTable.componentId, componentIds),
      eq(manufacturingMovementsTable.reason, "OPENING_BALANCE"),
    ));
  const openedIds = new Set(opened.map((row: any) => row.componentId));
  if (componentIds.some((id: number) => !openedIds.has(id))) {
    throw httpError("Every BOM component needs a recorded opening balance before enabling manufacturing availability.", 409);
  }
}

export function createManufacturingAvailabilityService(database: Database) {
  const service = {
    async componentBalances(componentId: number, tx: Database = database) {
      const [component] = await tx.select().from(manufacturingComponentsTable)
        .where(eq(manufacturingComponentsTable.id, componentId));
      if (!component) throw httpError("Component not found.", 404);
      const result = await balances(tx, [componentId]);
      return { componentId, ...result.get(componentId)!, sku: component.sku, name: component.name };
    },

    async availability(variantId: number, tx: Database = database) {
      const [variant] = await tx.select().from(productVariantsTable)
        .where(eq(productVariantsTable.id, variantId));
      if (!variant) throw httpError("Sellable variant not found.", 404);
      if (!variant.manufacturingEnabled) {
        return { variantId, manufacturingEnabled: false, bomId: null, producibleQuantity: null, status: "LEGACY" as const, components: [] };
      }
      const bom = await currentBom(tx, variantId);
      if (!bom) throw httpError("Manufacturing is enabled but the variant has no current BOM.", 409);
      if (!bom.components.length) throw httpError("Manufacturing requires at least one physical BOM component.", 409);
      const policy = await activePolicy(tx);
      const componentBalances = await balances(tx, bom.components.map((line: any) => line.componentId));
      const components = bom.components.map((line: any) => {
        const balance = componentBalances.get(line.componentId);
        return {
          componentId: line.componentId,
          sku: line.componentSkuSnapshot,
          name: line.componentNameSnapshot,
          quantityPerUnit: line.quantity,
          ...(balance ?? { physical: 0, held: 0, allocated: 0, available: 0 }),
          producibleQuantity: Math.max(0, Math.floor((balance?.available ?? 0) / line.quantity)),
        };
      });
      const producibleQuantity = components.length
        ? Math.min(...components.map((component: any) => component.producibleQuantity))
        : 0;
      const componentIds = bom.components.map((line: any) => line.componentId);
      const componentRows = componentIds.length ? await tx.select({
        id: manufacturingComponentsTable.id,
        active: manufacturingComponentsTable.active,
        replenishable: manufacturingComponentsTable.replenishable,
        leadDays: manufacturingComponentsTable.leadDays,
      }).from(manufacturingComponentsTable).where(inArray(manufacturingComponentsTable.id, componentIds)) : [];
      if (componentRows.length !== componentIds.length || componentRows.some((component: any) => !component.active)) {
        throw httpError("The current BOM contains a missing or inactive physical component.", 409);
      }
      const confirmedReplenishment = variant.allowOrderToReplenish
        && variant.maxOutstandingReplenishmentUnits > 0
        && componentRows.length === componentIds.length
        && componentRows.every((component: any) => component.replenishable
          && component.leadDays !== null && component.leadDays <= variant.promisedReplenishmentDays);
      const outstandingUnits = confirmedReplenishment
        ? await outstandingReplenishmentUnits(tx, variantId) : variant.maxOutstandingReplenishmentUnits;
      const status = producibleQuantity === 0
        ? (confirmedReplenishment && outstandingUnits < variant.maxOutstandingReplenishmentUnits
          ? "AVAILABLE_TO_ORDER" : "OUT_OF_STOCK")
        : producibleQuantity <= policy.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";
      return { variantId, manufacturingEnabled: true, bomId: bom.id, producibleQuantity, status, components };
    },

    async holdCheckout(intentId: string, lines: CheckoutLine[], reference?: string | null) {
      if (!intentId.trim()) throw httpError("Payment intent ID is required.", 400);
      if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1
        || !Number.isInteger(line.lineIndex) || line.lineIndex < 0)
        || new Set(lines.map((line) => line.lineIndex)).size !== lines.length) {
        throw httpError("Checkout lines require unique non-negative lineIndex and positive integer quantity.", 400);
      }
      return database.transaction(async (tx: Database) => {
        await lockPaymentIntent(tx, intentId);
        const prior = await tx.select().from(manufacturingCheckoutHoldsTable)
          .where(eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId));
        if (prior.length) return prior;

        const prepared = [];
        for (const line of lines) {
          const [variant] = await tx.select().from(productVariantsTable)
            .where(eq(productVariantsTable.id, line.variantId));
          if (!variant) throw httpError(`Variant ${line.variantId} was not found.`, 404);
          if (!variant.manufacturingEnabled) continue;
          const bom = await currentBom(tx, variant.id);
          if (!bom) throw httpError(`Variant ${variant.id} has no current BOM.`, 409);
          prepared.push({ line, variant, bom });
        }
        const componentIds = prepared.flatMap(({ bom }) => bom.components.map((row: any) => row.componentId));
        await lockComponents(tx, componentIds);
        const activeComponents = await tx.select({ id: manufacturingComponentsTable.id, active: manufacturingComponentsTable.active })
          .from(manufacturingComponentsTable).where(inArray(manufacturingComponentsTable.id, componentIds));
        if (activeComponents.length !== [...new Set(componentIds)].length || activeComponents.some((component: any) => !component.active)) {
          throw httpError("A current BOM component is missing or inactive.", 409);
        }
        const balancesById = await balances(tx, componentIds);
        const policy = await activePolicy(tx);
        const values = [];
        const checkoutReplenishmentUnits = new Map<number, number>();
        for (const { line, variant, bom } of prepared) {
          const requirements: Array<{ row: any; required: number; available: number }> = bom.components.map((row: any) => ({
            row,
            required: row.quantity * line.quantity,
            available: Math.max(0, balancesById.get(row.componentId)?.available ?? 0),
          }));
          const totalMissingUnits = Math.max(0, ...requirements.map(({ required, available, row }) =>
            Math.ceil(Math.max(0, required - available) / row.quantity)));
          if (totalMissingUnits > 0) {
            const shortfall = {
              variantId: variant.id,
              lineIndex: line.lineIndex,
              bomId: bom.id,
              requiredFinishedUnits: line.quantity,
              missingFinishedUnits: totalMissingUnits,
              components: requirements.filter(({ required, available }) => required > available).map(({ row, required, available }) => ({
                componentId: row.componentId,
                sku: row.componentSkuSnapshot,
                name: row.componentNameSnapshot,
                required,
                available,
                shortfall: required - available,
              })),
            };
            // Confirmed replenishment and lead-time are evaluated directly from
            // component records; no inferred backorder from supplier presence.
            const componentRows = await tx.select({
              id: manufacturingComponentsTable.id,
              replenishable: manufacturingComponentsTable.replenishable,
              leadDays: manufacturingComponentsTable.leadDays,
            }).from(manufacturingComponentsTable)
              .where(inArray(manufacturingComponentsTable.id, requirements.map(({ row }) => row.componentId)));
            const componentById = new Map<number, { id: number; replenishable: boolean; leadDays: number | null }>(
              componentRows.map((component: any) => [component.id, component]),
            );
            const allowed = variant.allowOrderToReplenish
              && totalMissingUnits <= variant.maxOutstandingReplenishmentUnits
              && requirements.filter(({ required, available }) => required > available).every(({ row }) => {
                const component = componentById.get(row.componentId);
                return component?.replenishable === true && component.leadDays !== null
                  && component.leadDays <= variant.promisedReplenishmentDays;
              });
            if (!allowed) {
              throw httpError(`Insufficient component availability for variant ${variant.id}.`, 409, { shortfall });
            }
            const outstanding = await outstandingReplenishmentUnits(tx, variant.id);
            const alreadyRequested = checkoutReplenishmentUnits.get(variant.id) ?? 0;
            if (outstanding + alreadyRequested + totalMissingUnits > variant.maxOutstandingReplenishmentUnits) {
              throw httpError("Variant replenishment outstanding-unit limit would be exceeded.", 409, { shortfall });
            }
            checkoutReplenishmentUnits.set(variant.id, alreadyRequested + totalMissingUnits);
          }
          for (const { row, required, available } of requirements) {
            const held = Math.min(required, available);
            values.push({
              paymentIntentId: intentId,
              lineIndex: line.lineIndex,
              variantId: variant.id,
              bomId: bom.id,
              componentId: row.componentId,
              componentSkuSnapshot: row.componentSkuSnapshot,
              componentNameSnapshot: row.componentNameSnapshot,
              requiredQuantity: required,
              heldQuantity: held,
              shortfallQuantity: required - held,
              checkoutReference: reference ?? null,
              expiresAt: sql`now() + (${policy.holdDurationMinutes} * interval '1 minute')`,
              status: "ACTIVE",
            });
            const balance = balancesById.get(row.componentId);
            if (balance) {
              balance.held += held;
              balance.available -= held;
            }
          }
        }
        if (!values.length) return [];
        return tx.insert(manufacturingCheckoutHoldsTable).values(values as any).returning();
      });
    },

    async releaseCheckout(intentId: string) {
      return database.transaction(async (tx: Database) => {
        const activeRows = await tx.select().from(manufacturingCheckoutHoldsTable)
          .where(and(
            eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId),
            eq(manufacturingCheckoutHoldsTable.status, "ACTIVE"),
            sql`${manufacturingCheckoutHoldsTable.expiresAt} > now()`,
          ));
        await lockComponents(tx, activeRows.map((row: any) => row.componentId));
        return tx.update(manufacturingCheckoutHoldsTable)
          .set({ status: "RELEASED" })
          .where(and(
            eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId),
            eq(manufacturingCheckoutHoldsTable.status, "ACTIVE"),
            sql`${manufacturingCheckoutHoldsTable.expiresAt} > now()`,
          )).returning();
      });
    },

    /** Must receive the surrounding shop/payment-finalization transaction. */
    async convertPaidCheckout(tx: Database, intentId: string, orderId: number, orderItemByLineIndex: AllocationItemMap) {
      await lockPaymentIntent(tx, intentId);
      const prior = await tx.select().from(manufacturingAllocationsTable)
        .where(eq(manufacturingAllocationsTable.paymentIntentId, intentId));
      if (prior.length) return prior;
      let holds = await tx.select().from(manufacturingCheckoutHoldsTable)
        .where(eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId));
      if (!holds.length) return [];
      await lockComponents(tx, holds.map((hold: any) => hold.componentId));
      const afterLock = await tx.select().from(manufacturingAllocationsTable)
        .where(eq(manufacturingAllocationsTable.paymentIntentId, intentId));
      if (afterLock.length) return afterLock;
      holds = await tx.select().from(manufacturingCheckoutHoldsTable)
        .where(eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId));
      const balanceById = await balances(tx, holds.map((hold: any) => hold.componentId));
      const expired = await tx.update(manufacturingCheckoutHoldsTable).set({ status: "EXPIRED" })
        .where(and(
          eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId),
          eq(manufacturingCheckoutHoldsTable.status, "ACTIVE"),
          sql`${manufacturingCheckoutHoldsTable.expiresAt} <= now()`,
        )).returning({ id: manufacturingCheckoutHoldsTable.id });
      const expiredIds = new Set(expired.map((row: any) => row.id));
      const allocations = [];
      for (const hold of holds as any[]) {
        const orderItemId = mapItem(orderItemByLineIndex, hold.lineIndex);
        if (!orderItemId) throw httpError(`Missing order item for checkout line ${hold.lineIndex}.`, 400);
        const stillActive = hold.status === "ACTIVE" && !expiredIds.has(hold.id);
        const balance = balanceById.get(hold.componentId)!;
        const preservedHold = stillActive ? hold.heldQuantity : 0;
        // Holds are reservations, not stock. Re-check after expiry/stock changes:
        // only the physically supportable share of this hold may convert.
        const allocatedQuantity = Math.min(hold.requiredQuantity, Math.max(0, balance.available + preservedHold));
        const shortfallQuantity = hold.requiredQuantity - allocatedQuantity;
        const holdExpired = expiredIds.has(hold.id) || hold.status === "EXPIRED";
        const manualReviewRequired = shortfallQuantity > hold.shortfallQuantity
          && (holdExpired || hold.status === "RELEASED");
        allocations.push({
          orderId, orderItemId, paymentIntentId: intentId, lineIndex: hold.lineIndex,
          variantId: hold.variantId, bomId: hold.bomId, componentId: hold.componentId,
          componentSkuSnapshot: hold.componentSkuSnapshot,
          componentNameSnapshot: hold.componentNameSnapshot,
          requiredQuantity: hold.requiredQuantity, allocatedQuantity, shortfallQuantity,
          manualReviewRequired,
          manualReviewReason: manualReviewRequired
            ? holdExpired ? "HOLD_EXPIRED_STOCK_UNAVAILABLE" : "HOLD_RELEASED_STOCK_UNAVAILABLE"
            : null,
          status: "CONFIRMED",
        });
        balance.available += preservedHold - allocatedQuantity;
        if (stillActive) balance.held -= preservedHold;
      }
      if (allocations.length) {
        const inserted = await tx.insert(manufacturingAllocationsTable).values(allocations as any).returning();
        await tx.update(manufacturingCheckoutHoldsTable).set({ status: "CONVERTED" })
          .where(and(
            eq(manufacturingCheckoutHoldsTable.paymentIntentId, intentId),
            eq(manufacturingCheckoutHoldsTable.status, "ACTIVE"),
            sql`${manufacturingCheckoutHoldsTable.expiresAt} > now()`,
          ));
        return inserted;
      }
      return [];
    },

    async releaseOrderAllocations(tx: Database, orderId: number) {
      const confirmed = await tx.select().from(manufacturingAllocationsTable)
        .where(and(
          eq(manufacturingAllocationsTable.orderId, orderId),
          eq(manufacturingAllocationsTable.status, "CONFIRMED"),
        ));
      await lockComponents(tx, confirmed.map((row: any) => row.componentId));
      return tx.update(manufacturingAllocationsTable).set({ status: "RELEASED" })
        .where(and(
          eq(manufacturingAllocationsTable.orderId, orderId),
          eq(manufacturingAllocationsTable.status, "CONFIRMED"),
        )).returning();
    },

    async setVariantManufacturingEnabled(variantId: number, enabled: boolean) {
      return database.transaction(async (tx: Database) => {
        const productId = enabled ? await lockProductVariantActivation(tx, variantId) : undefined;
        const [variant] = await tx.select().from(productVariantsTable)
          .where(eq(productVariantsTable.id, variantId)).for("update");
        if (!variant) throw httpError("Sellable variant not found.", 404);
        if (enabled) await assertManufacturingCanBeEnabled(tx, variantId, productId!);
        const [updated] = await tx.update(productVariantsTable).set({
          manufacturingEnabled: enabled,
        }).where(eq(productVariantsTable.id, variantId)).returning();
        return updated;
      });
    },

    async updateVariantReplenishmentPolicy(variantId: number, input: {
      allowOrderToReplenish: boolean; maxOutstandingReplenishmentUnits: number; promisedReplenishmentDays: number;
    }) {
      const [updated] = await database.update(productVariantsTable).set(input)
        .where(eq(productVariantsTable.id, variantId)).returning();
      return updated ?? null;
    },

    async configureVariantAvailabilityPolicy(variantId: number, input: {
      manufacturingEnabled?: boolean;
      allowOrderToReplenish: boolean;
      maxOutstandingReplenishmentUnits: number;
      promisedReplenishmentDays: number;
    }) {
      return database.transaction(async (tx: Database) => {
        const productId = input.manufacturingEnabled === true
          ? await lockProductVariantActivation(tx, variantId) : undefined;
        const [variant] = await tx.select({ id: productVariantsTable.id })
          .from(productVariantsTable).where(eq(productVariantsTable.id, variantId)).for("update");
        if (!variant) throw httpError("Sellable variant not found.", 404);
        // Validate activation before writing either the eligibility flag or any
        // replenishment fields so failure cannot leave a partial policy update.
        if (input.manufacturingEnabled === true) {
          await assertManufacturingCanBeEnabled(tx, variantId, productId!);
        }
        const [updated] = await tx.update(productVariantsTable).set(input)
          .where(eq(productVariantsTable.id, variantId)).returning();
        return updated;
      });
    },

    async updateAvailabilityPolicy(input: { lowStockThreshold: number; holdDurationMinutes: number }) {
      const [updated] = await database.insert(manufacturingAvailabilityPoliciesTable).values({
        id: 1, ...input, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: manufacturingAvailabilityPoliciesTable.id,
        set: { ...input, updatedAt: new Date() },
      }).returning();
      return updated;
    },

    async orderReadiness(orderId: number, tx: Database = database) {
      const rows = await tx.select().from(manufacturingAllocationsTable)
        .where(eq(manufacturingAllocationsTable.orderId, orderId));
      const grouped = new Map<number, any>();
      for (const row of rows) {
        const group = grouped.get(row.orderItemId) ?? { orderItemId: row.orderItemId, components: [] };
        group.components.push({
          componentId: row.componentId, sku: row.componentSkuSnapshot, name: row.componentNameSnapshot,
          required: row.requiredQuantity, allocated: row.allocatedQuantity,
          shortfall: row.shortfallQuantity, status: row.status,
          manualReviewRequired: row.manualReviewRequired,
          manualReviewReason: row.manualReviewReason,
        });
        grouped.set(row.orderItemId, group);
      }
      const items = [...grouped.values()].map((item) => {
        const active = item.components.filter((component: any) => component.status === "CONFIRMED");
        const short = active.filter((component: any) => component.shortfall > 0);
        const manualReviewRequired = item.components.some((component: any) => component.manualReviewRequired);
        return {
          ...item,
          manualReviewRequired,
          readiness: !active.length && item.components.length ? "WAITING_FOR_COMPONENTS"
            : short.length === 0 ? "FULLY_ALLOCATED"
            : active.some((component: any) => component.allocated > 0) ? "PARTIALLY_ALLOCATED" : "WAITING_FOR_COMPONENTS",
        };
      });
      const active = items.flatMap((item) => item.components.filter((component: any) => component.status === "CONFIRMED"));
      const short = active.filter((component: any) => component.shortfall > 0);
      const hasAllocationHistory = rows.length > 0;
      const readiness = hasAllocationHistory && active.length === 0 ? "WAITING_FOR_COMPONENTS"
        : short.length === 0 ? "FULLY_ALLOCATED"
        : active.some((component: any) => component.allocated > 0) ? "PARTIALLY_ALLOCATED" : "WAITING_FOR_COMPONENTS";
      return {
        orderId, readiness, items,
        manualReviewRequired: rows.some((row: any) => row.manualReviewRequired),
      };
    },
  };
  return service;
}