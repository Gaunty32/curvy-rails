import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertOpeningBalanceAvailable,
  nextBomVersion,
  stocktakeVariance,
} from "../src/services/manufacturing-rules.js";

describe("Phase 1 manufacturing invariants", () => {
  it("allows exactly the first opening balance, including a counted zero", () => {
    expect(() => assertOpeningBalanceAvailable(0, false)).not.toThrow();
    expect(() => assertOpeningBalanceAvailable(0, true)).toThrow(/Opening balance/);
    expect(() => assertOpeningBalanceAvailable(4, false)).toThrow(/Opening balance/);
  });

  it("rejects stale stocktake approval and computes the counted variance", () => {
    expect(stocktakeVariance(8, 8, 5, 12, 12)).toBe(-3);
    expect(stocktakeVariance(8, 8, 11, 12, 12)).toBe(3);
    expect(() => stocktakeVariance(8, 7, 5, 12, 12)).toThrow(/changed after this stocktake/);
    expect(() => stocktakeVariance(8, 8, 5, 12, 14)).toThrow(/changed after this stocktake/);
  });

  it("assigns a new sequential BOM version rather than editing an existing version", () => {
    expect(nextBomVersion(null)).toBe(1);
    expect(nextBomVersion(3)).toBe(4);
    const migration = readFileSync(new URL("../../../lib/db/drizzle/0006_manufacturing_phase1.sql", import.meta.url), "utf8");
    expect(migration).toMatch(/manufacturing_bom_components_append_only/);
    expect(migration).toMatch(/manufacturing_bom_operations_append_only/);
    expect(migration).toMatch(/manufacturing_bom_header_immutable/);
  });
});