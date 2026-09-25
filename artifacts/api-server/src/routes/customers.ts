import { Router, type IRouter } from "express";
import { eq, ilike, or, isNotNull, and, ne, sql } from "drizzle-orm";
import { db, customersTable, ordersTable, customerEmployeesTable } from "@workspace/db";
import { z } from "zod";
import { randomBytes } from "crypto";
import { pushCustomerToXero, refreshInvoiceStatusesFromXero } from "../services/xero.js";
import { pushCustomerToHighLevel, syncCustomerToPhoneDirectory } from "../services/contacts-sync.js";
import { toDisplayCase } from "../lib/display-case.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";
import {
  CreateCustomerBody,
  UpdateCustomerBody,
  GetCustomerParams,
  UpdateCustomerParams,
  DeleteCustomerParams,
  ListCustomersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  const query = ListCustomersQueryParams.safeParse(req.query);
  let customers;
  if (query.success && query.data.search) {
    const term = `%${query.data.search}%`;
    customers = await db
      .select()
      .from(customersTable)
      .where(or(
        ilike(customersTable.name, term),
        ilike(customersTable.email, term),
        ilike(customersTable.phone, term),
        ilike(customersTable.contactFirstName, term),
        ilike(customersTable.contactLastName, term),
      ))
      .orderBy(customersTable.name);
  } else {
    customers = await db.select().from(customersTable).orderBy(customersTable.name);
  }
  res.json(customers);
});

router.post("/customers", async (req, res): Promise<void> => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [customer] = await db.insert(customersTable).values(parsed.data).returning();
  res.status(201).json(customer);

  // Best-effort push to Xero + phone directory — don't await so response is immediate
  pushCustomerToXero(customer.id).catch(() => {});
  syncCustomerToPhoneDirectory(customer.id).catch(() => {});

  // Auto-create default employee + portal user from primary contact details
  const { contactFirstName, contactLastName, email, phone } = parsed.data;
  if (contactFirstName?.trim()) {
    autoCreateContactDefaults(customer.id, contactFirstName.trim(), contactLastName ?? null, email ?? null, phone ?? null).catch(() => {});
  }
});

async function autoCreateContactDefaults(
  customerId: number,
  firstName: string,
  lastName: string | null,
  email: string | null,
  phone: string | null,
): Promise<void> {
  const [employee] = await db.insert(customerEmployeesTable).values({
    customerId,
    firstName,
    lastName: lastName || null,
    email: email ? email.toLowerCase().trim() : null,
    phone: phone || null,
    isActive: true,
  }).returning();

  if (email && employee) {
    const normalised = email.toLowerCase().trim();
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.execute(sql`
      INSERT INTO customer_portal_users
        (customer_id, email, invite_token, invite_expires_at, status, portal_role, linked_employee_id)
      VALUES
        (${customerId}, ${normalised}, ${token}, ${expires.toISOString()}, 'pending', 'manager', ${employee.id})
      ON CONFLICT (email) DO NOTHING
    `);
  }
}

// ─── Import a contact from High Level as a new customer ───────────────────────
router.post("/customers/import-from-hl", async (req, res): Promise<void> => {
  const hlContactId = z.string().trim().min(5).max(100).safeParse(
    req.body?.hlContactId ?? req.body?.contactId ?? req.body?.contact?.id,
  );
  if (!hlContactId.success) {
    res.status(400).json({ error: "hlContactId is required" });
    return;
  }
  const contactId = hlContactId.data;

  // Load HL credentials
  const settingsRows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('high_level_api_key', 'high_level_location_id')
  `);
  const settingsMap = Object.fromEntries(
    (settingsRows.rows as any[]).map((r: any) => [r.key, r.value])
  );
  const apiKey: string | undefined = settingsMap["high_level_api_key"];
  if (!apiKey) { res.status(400).json({ error: "High Level API key not configured — go to Settings → High Level." }); return; }

  // Fetch the contact from HL
  let hlContact: any;
  try {
    await assertIntegrationOutboundAllowed("highlevel");
    const hlRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" } }
    );
    if (!hlRes.ok) { res.status(502).json({ error: `High Level returned ${hlRes.status}` }); return; }
    const hlData = await hlRes.json() as any;
    hlContact = hlData?.contact ?? hlData;
  } catch (err: any) {
    res.status(502).json({ error: `Could not reach High Level: ${err.message}` }); return;
  }

  const displayFirstName = toDisplayCase(hlContact.firstName);
  const displayLastName = toDisplayCase(hlContact.lastName);
  const displayCompanyName = toDisplayCase(hlContact.companyName);

  // Keep HighLevel itself consistently formatted, including contacts created
  // directly in HighLevel before they are pushed into the order system.
  try {
    await assertIntegrationOutboundAllowed("highlevel");
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Version": "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(displayFirstName ? { firstName: displayFirstName } : {}),
        ...(displayLastName ? { lastName: displayLastName } : {}),
        ...(displayCompanyName ? { companyName: displayCompanyName } : {}),
      }),
    });
  } catch {
    // Name formatting is best-effort; a blocked or failed sync does not prevent import.
  }

  // Check if this HL contact is already a customer
  const existing = await db.execute(sql`
    SELECT id FROM customers WHERE high_level_contact_id = ${contactId} LIMIT 1
  `);
  if ((existing.rows as any[]).length > 0) {
    const existingId = (existing.rows[0] as any).id;
    await markHighLevelContactAsCustomer(contactId, apiKey);
    res.json({ customerId: existingId, alreadyExisted: true, highLevelStatus: "sbs account created" });
    return;
  }

  // Also check by email to avoid duplicates
  const email = hlContact.email?.toLowerCase().trim() ?? null;
  if (email) {
    const byEmail = await db.execute(sql`
      SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1
    `);
    if ((byEmail.rows as any[]).length > 0) {
      const existingId = (byEmail.rows[0] as any).id;
      // Update the HL contact ID on the existing record
      await db.execute(sql`
        UPDATE customers SET
          high_level_contact_id = ${contactId},
          contact_first_name = COALESCE(contact_first_name, ${displayFirstName ?? null}),
          contact_last_name  = COALESCE(contact_last_name,  ${displayLastName  ?? null}),
          phone = COALESCE(phone, ${hlContact.phone ?? null}),
          updated_at = now()
        WHERE id = ${existingId}
      `);
      await markHighLevelContactAsCustomer(contactId, apiKey);
      res.json({ customerId: existingId, alreadyExisted: true, highLevelStatus: "sbs account created" });
      return;
    }
  }

  // Build the company / customer name
  const billingName = [displayFirstName, displayLastName].filter(Boolean).join(" ");
  const companyName = displayCompanyName || billingName || "Unknown";

  // Build address from HL fields
  const address = [hlContact.address1].filter(Boolean).join(", ") || null;
  const city    = hlContact.city     ?? null;
  const state   = hlContact.state    ?? null;
  const postcode = hlContact.postalCode ?? null;

  // Create the customer
  const result = await db.execute(sql`
    INSERT INTO customers (
      name, contact_first_name, contact_last_name, email, phone,
      address, city, state, postcode, high_level_contact_id,
      created_at, updated_at
    ) VALUES (
      ${companyName},
      ${displayFirstName ?? null},
      ${displayLastName  ?? null},
      ${email},
      ${hlContact.phone ?? null},
      ${address},
      ${city},
      ${state},
      ${postcode},
      ${contactId},
      now(), now()
    )
    RETURNING id
  `);
  const customerId = (result.rows[0] as any).id;

  // Auto-create default contact/portal user
  if (displayFirstName) {
    await autoCreateContactDefaults(
      customerId,
      displayFirstName,
      displayLastName ?? null,
      email,
      hlContact.phone ?? null,
    ).catch(() => {});
  }

  await markHighLevelContactAsCustomer(contactId, apiKey);
  res.status(201).json({ customerId, alreadyExisted: false, highLevelStatus: "sbs account created" });
});

async function markHighLevelContactAsCustomer(contactId: string, apiKey: string): Promise<void> {
  await assertIntegrationOutboundAllowed("highlevel");
  const response = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tags: ["customer", "sbs account created"] }),
  });
  if (!response.ok) {
    throw new Error(`High Level contact was imported but could not be marked as created (${response.status})`);
  }
}

router.get("/customers/:id", async (req, res): Promise<void> => {
  const params = GetCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, params.data.id));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const params = UpdateCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [customer] = await db
    .update(customersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(customersTable.id, params.data.id))
    .returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
  // Best-effort sync to Xero + phone directory — don't await so response is immediate
  pushCustomerToXero(params.data.id).catch(() => {});
  syncCustomerToPhoneDirectory(params.data.id).catch(() => {});
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const params = DeleteCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db.delete(customersTable).where(eq(customersTable.id, params.data.id)).returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/customers/:id/invoice-summary", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  // Balance due is computed from locally-stored xero_invoice_status, which is only
  // ever written when we post an invoice. If the customer later pays it directly in
  // Xero (bank feed, manual reconciliation, etc.) our copy goes stale. Refresh any
  // not-yet-PAID invoices against Xero first so the figures below match reality.
  const candidates = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.customerId, id),
      isNotNull(ordersTable.xeroInvoiceId),
      sql`${ordersTable.xeroInvoiceStatus} IS DISTINCT FROM 'PAID'`,
      sql`${ordersTable.xeroInvoiceStatus} IS DISTINCT FROM 'VOIDED'`,
      sql`${ordersTable.xeroInvoiceStatus} IS DISTINCT FROM 'DELETED'`,
    ));
  if (candidates.length > 0) {
    await refreshInvoiceStatusesFromXero(candidates.map((c) => c.id)).catch(() => {});
  }

  // Compute gross (inc-VAT) total per order by joining order_items.
  // Mirrors the exact formula used in the invoice email:
  //   gross = totalAmount + carriageAmount + SUM(lineTotal * vatRate) + carriageAmount * 0.20
  const rows = await db.execute(sql`
    SELECT
      o.id,
      o.order_number         AS "orderNumber",
      o.total_amount         AS "totalAmount",
      o.carriage_amount      AS "carriageAmount",
      o.invoice_email_sent_at AS "invoiceEmailSentAt",
      o.xero_invoice_id      AS "xeroInvoiceId",
      o.xero_invoice_status  AS "xeroInvoiceStatus",
      o.dispatched_at        AS "dispatchedAt",
      o.order_date           AS "orderDate",
      COALESCE(SUM(oi.line_total::numeric * oi.vat_rate::numeric), 0) AS "vatOnItems",
      o.total_amount::numeric
        + o.carriage_amount::numeric
        + COALESCE(SUM(oi.line_total::numeric * oi.vat_rate::numeric), 0)
        + o.carriage_amount::numeric * 0.20
        AS "grossTotal"
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ${id}
      AND o.invoice_email_sent_at IS NOT NULL
    GROUP BY o.id
    ORDER BY o.invoice_email_sent_at
  `);

  const invoicedOrders = rows.rows as Array<{
    id: number;
    orderNumber: string;
    totalAmount: string;
    carriageAmount: string;
    invoiceEmailSentAt: string;
    xeroInvoiceId: string | null;
    xeroInvoiceStatus: string | null;
    dispatchedAt: string | null;
    orderDate: string | null;
    vatOnItems: string;
    grossTotal: string;
  }>;

  const PAID_STATUSES = ["PAID", "VOIDED", "DELETED"];
  const unpaid = invoicedOrders.filter(
    (o) => !PAID_STATUSES.includes((o.xeroInvoiceStatus || "").toUpperCase())
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const overdue = unpaid.filter(
    (o) => o.invoiceEmailSentAt && new Date(o.invoiceEmailSentAt) < cutoff
  );

  const balanceDue = unpaid.reduce((sum, o) => sum + parseFloat(o.grossTotal || "0"), 0);
  const overdueTotal = overdue.reduce((sum, o) => sum + parseFloat(o.grossTotal || "0"), 0);

  res.json({
    balanceDue: balanceDue.toFixed(2),
    overdueTotal: overdueTotal.toFixed(2),
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    overdueInvoices: overdue.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      amount: parseFloat(o.grossTotal || "0").toFixed(2),
      invoicedAt: o.invoiceEmailSentAt,
      daysOverdue: Math.floor((Date.now() - new Date(o.invoiceEmailSentAt!).getTime()) / 86400000) - 14,
      xeroInvoiceId: o.xeroInvoiceId,
      xeroInvoiceStatus: o.xeroInvoiceStatus,
    })),
  });
});

// ─── Open PO routes ───────────────────────────────────────────────────────────

router.get("/customers/:id/open-pos", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  const rows = await db.execute(sql`
    SELECT id, po_number, total_value, remaining_value, expiry_date, status, created_at
    FROM customer_open_pos
    WHERE customer_id = ${id}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  res.json((rows.rows as any[]).map(r => ({
    id: r.id,
    poNumber: r.po_number,
    totalValue: parseFloat(r.total_value),
    remainingValue: parseFloat(r.remaining_value),
    usedValue: parseFloat(r.total_value) - parseFloat(r.remaining_value),
    expiryDate: r.expiry_date,
    status: r.status,
    createdAt: r.created_at,
  })));
});

router.get("/customers/:id/open-pos/active", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(sql`
    UPDATE customer_open_pos SET status = 'expired', updated_at = now()
    WHERE customer_id = ${id} AND status = 'active' AND expiry_date < ${today}
  `);
  const rows = await db.execute(sql`
    SELECT id, po_number, total_value, remaining_value, expiry_date, status
    FROM customer_open_pos
    WHERE customer_id = ${id} AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `);
  const po = (rows.rows[0] as any) ?? null;
  if (!po) { res.json(null); return; }
  res.json({
    id: po.id,
    poNumber: po.po_number,
    totalValue: parseFloat(po.total_value),
    remainingValue: parseFloat(po.remaining_value),
    usedValue: parseFloat(po.total_value) - parseFloat(po.remaining_value),
    expiryDate: po.expiry_date,
    status: po.status,
  });
});

// ─── Bulk-push "customer" tag to all contacts in HighLevel ────────────────────
router.post("/customers/bulk-ghl-tag", async (req, res): Promise<void> => {
  const settingsRows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('high_level_api_key', 'high_level_location_id')
  `);
  const settingsMap = Object.fromEntries(
    (settingsRows.rows as any[]).map((r: any) => [r.key, r.value])
  );
  const apiKey: string | undefined = settingsMap["high_level_api_key"];
  const locationId: string | undefined = settingsMap["high_level_location_id"];
  if (!apiKey || !locationId) {
    res.status(400).json({ error: "High Level API key / location not configured." });
    return;
  }

  const tagName: string = (req.body?.tag as string) || "customer";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };

  // Get all non-archived customers
  const custRows = await db.execute(sql`
    SELECT id, high_level_contact_id FROM customers WHERE is_archived = false
  `);
  const customers = custRows.rows as Array<{ id: number; high_level_contact_id: string | null }>;

  let tagged = 0;
  let synced = 0;
  let failed = 0;

  for (const c of customers) {
    let contactId = c.high_level_contact_id;

    // If no GHL contact yet, sync first to create/link one
    if (!contactId) {
      try {
        await assertIntegrationOutboundAllowed("highlevel");
        await pushCustomerToHighLevel(c.id);
        const refreshed = await db.execute(sql`
          SELECT high_level_contact_id FROM customers WHERE id = ${c.id}
        `);
        contactId = (refreshed.rows[0] as any)?.high_level_contact_id ?? null;
        if (contactId) synced++;
      } catch {
        failed++;
        continue;
      }
    }

    if (!contactId) { failed++; continue; }

    try {
      await assertIntegrationOutboundAllowed("highlevel");
      const tagRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
        { method: "POST", headers, body: JSON.stringify({ tags: [tagName] }) }
      );
      if (tagRes.ok) {
        tagged++;
      } else {
        const txt = await tagRes.text().catch(() => "");
        console.error(`[GHL bulk-tag] contact ${contactId} → ${tagRes.status} ${txt}`);
        failed++;
      }
    } catch (e: any) {
      console.error(`[GHL bulk-tag] contact ${contactId} error: ${e.message}`);
      failed++;
    }
  }

  res.json({ total: customers.length, tagged, synced, failed, tag: tagName });
});

router.post("/customers/:id/open-pos", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  const parsed = z.object({
    poNumber: z.string().min(1).max(100),
    totalValue: z.number().positive(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors.map(e => e.message).join("; ") }); return; }
  const { poNumber, totalValue, expiryDate } = parsed.data;
  // Deactivate any existing active PO for this customer
  await db.execute(sql`
    UPDATE customer_open_pos SET status = 'exhausted', updated_at = now()
    WHERE customer_id = ${id} AND status = 'active'
  `);
  const result = await db.execute(sql`
    INSERT INTO customer_open_pos (customer_id, po_number, total_value, remaining_value, expiry_date, status, created_at, updated_at)
    VALUES (${id}, ${poNumber}, ${totalValue.toFixed(2)}, ${totalValue.toFixed(2)}, ${expiryDate}, 'active', now(), now())
    RETURNING id, po_number, total_value, remaining_value, expiry_date, status
  `);
  const po = result.rows[0] as any;
  res.status(201).json({
    id: po.id,
    poNumber: po.po_number,
    totalValue: parseFloat(po.total_value),
    remainingValue: parseFloat(po.remaining_value),
    usedValue: 0,
    expiryDate: po.expiry_date,
    status: po.status,
  });
});

export default router;
