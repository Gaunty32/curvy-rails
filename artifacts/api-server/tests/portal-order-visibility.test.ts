import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.PORTAL_JWT_SECRET ??= "portal-order-visibility-focused-test-secret";
const { buildPortalOrderVisibilityCondition } = await import("../src/routes/portal.js");
const dialect = new PgDialect();

function sqlFor(role: string, employeeId: number | null, email: string | null) {
  return dialect.sqlToQuery(buildPortalOrderVisibilityCondition(role, employeeId, email));
}

describe("portal order visibility", () => {
  it("keeps managers within their listed non-pending order scope", () => {
    const query = sqlFor("manager", null, null);
    expect(query.sql).toContain("orders.portal_status IS DISTINCT FROM 'pending_review'");
    expect(query.params).toEqual([]);
  });

  it("allows dept managers non-pending orders and only their own pending orders", () => {
    const query = sqlFor("dept_manager", 41, "dept@example.test");
    expect(query.sql).toContain("orders.portal_submitted_by_employee_id = $1");
    expect(query.sql).toContain("lower(orders.portal_submitted_by_email) = lower($2)");
    expect(query.sql).toContain("orders.portal_status IS DISTINCT FROM 'pending_review'");
    expect(query.params).toEqual([41, "dept@example.test"]);
  });

  it("restricts members to their own submitter email and fails closed without identity", () => {
    const ownOrder = sqlFor("member", null, "member@example.test");
    expect(ownOrder.sql).toContain("lower(orders.portal_submitted_by_email) = lower($1)");
    expect(ownOrder.params).toEqual(["member@example.test"]);

    const noIdentity = sqlFor("member", null, null);
    expect(noIdentity.sql).toBe("false");
    expect(noIdentity.params).toEqual([]);
  });

  it("does not broaden an unlinked dept manager to other pending orders", () => {
    const query = sqlFor("dept_manager", null, null);
    expect(query.sql).toContain("orders.portal_status IS DISTINCT FROM 'pending_review'");
    expect(query.sql).not.toContain(" OR ");
  });
});