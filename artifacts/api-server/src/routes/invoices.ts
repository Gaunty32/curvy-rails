import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ordersTable, orderItemsTable, customersTable, settingsTable, customerEmployeesTable } from "@workspace/db";
import { eq, desc, and, isNotNull, isNull, sql, inArray } from "drizzle-orm";
import {
  sendInvoiceEmail, getSmtpConfig, testSmtpConnection,
  buildInvoiceEmail, generateInvoicePDF, buildInvoiceDataForOrder,
  fetchLogoDataUrl, sendEmail,
  buildLocalDeliveryNotificationEmail,
  buildDeliveryFollowupEmail,
} from "../services/email";
import { getTemplate, applyVars } from "../services/template-engine";
import { postInvoiceToXero } from "../services/xero";
import { logOrderAction, getActor } from "../services/orderLog";
import { getUncachableStripeClient } from "../services/stripeClient";
import { fireWorkflow } from "../services/workflow-engine.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

const router: IRouter = Router();

const resolvedCustomerInvoiceEmail = sql<string | null>`
  COALESCE(
    NULLIF(BTRIM(${customersTable.billingEmail}), ''),
    NULLIF(BTRIM(${customersTable.email}), '')
  )
`;

// Converts a UK wall-clock time (e.g. "2026-07-04" at 09:00) into the correct UTC instant,
// automatically accounting for GMT/BST — the business operates on UK local time, but the
// server (and node-cron) run in UTC, so a naive "09:00Z" literal is wrong for half the year.
function londonWallTimeToUtc(dateStr: string, hour: number, minute = 0): Date {
  const naiveUtc = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(naiveUtc).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetPart.match(/GMT([+-]\d+)?/);
  const offsetHours = match?.[1] ? parseInt(match[1], 10) : 0;
  return new Date(naiveUtc.getTime() - offsetHours * 60 * 60 * 1000);
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

// ─── List invoiceable orders ─────────────────────────────────────────────────
// Returns dispatched orders split into two groups:
//   to_send  — not yet emailed
//   to_post  — emailed but not yet in Xero

router.get("/invoices", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      status: ordersTable.status,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceDate: ordersTable.invoiceDate,
      trackingNumber: ordersTable.trackingNumber,
      shippingMethod: ordersTable.shippingMethod,
      paidAt: ordersTable.paidAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      invoiceEmailSentTo: ordersTable.invoiceEmailSentTo,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      xeroInvoiceStatus: ordersTable.xeroInvoiceStatus,
      customerPhone: customersTable.phone,
      customerEmail: resolvedCustomerInvoiceEmail,
      invoiceScheduledSendAt: ordersTable.invoiceScheduledSendAt,
      invoiceScheduleToEmail: ordersTable.invoiceScheduleToEmail,
      customerHighLevelContactId: customersTable.highLevelContactId,
      poNumber: ordersTable.poNumber,
      poNumberRequired: customersTable.poNumberRequired,
      deliveryAddressId: ordersTable.deliveryAddressId,
      zeroVat: customersTable.zeroVat,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(
      inArray(ordersTable.status, ["shipped", "dispatched", "part_shipped"]),
      isNotNull(ordersTable.dispatchedAt),
    ))
    .orderBy(desc(ordersTable.dispatchedAt));

  const toSend = orders.filter((o) => !o.invoiceEmailSentAt && !o.xeroInvoiceId && o.xeroInvoiceStatus !== "ZERO_VALUE");
  const toPost = orders.filter((o) => o.invoiceEmailSentAt && !o.xeroInvoiceId && o.xeroInvoiceStatus !== "ZERO_VALUE");
  const done = orders.filter((o) => !!o.xeroInvoiceId || o.xeroInvoiceStatus === "ZERO_VALUE");

  res.json({ toSend, toPost, done });
});

// ─── Update invoice date ──────────────────────────────────────────────────────

router.patch("/invoices/:orderId/invoice-date", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const body = z.object({ invoiceDate: z.string() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "invoiceDate (ISO string) required" }); return; }

  const date = new Date(body.data.invoiceDate);
  if (isNaN(date.getTime())) { res.status(400).json({ error: "Invalid date" }); return; }

  await db.update(ordersTable)
    .set({ invoiceDate: date, updatedAt: new Date() })
    .where(eq(ordersTable.id, idParse.data));

  res.json({ ok: true });
});

// ─── Update tracking number ──────────────────────────────────────────────────

router.patch("/invoices/:orderId/tracking", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const body = z.object({ trackingNumber: z.string().nullable() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "trackingNumber required" }); return; }

  await db.update(ordersTable)
    .set({ trackingNumber: body.data.trackingNumber, updatedAt: new Date() })
    .where(eq(ordersTable.id, idParse.data));

  res.json({ ok: true });
});

// ─── Consolidated invoice (multiple orders → single PDF) ─────────────────────
// IMPORTANT: must be registered BEFORE the parameterised /invoices/:orderId/send-email
// route, otherwise Express matches "consolidated" as the :orderId param.

router.post("/invoices/consolidated/send-email", async (req, res): Promise<void> => {
  const body = z.object({
    orderIds: z.array(z.number().int().positive()).min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "orderIds array required" }); return; }

  try {
    const { orderIds } = body.data;

    // Fetch all orders with customer info
    const orderRows = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.customerName,
        customerId: ordersTable.customerId,
        totalAmount: ordersTable.totalAmount,
        carriageAmount: ordersTable.carriageAmount,
        status: ordersTable.status,
        poNumber: ordersTable.poNumber,
        notes: ordersTable.notes,
        customerEmail: resolvedCustomerInvoiceEmail,
        contactFirstName: customersTable.contactFirstName,
        customerLogoUrl: customersTable.logoUrl,
        customerAddress: customersTable.address,
        customerCity: customersTable.city,
        customerPostcode: customersTable.postcode,
        poNumberRequired: customersTable.poNumberRequired,
        zeroVat: customersTable.zeroVat,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(inArray(ordersTable.id, orderIds));

    if (orderRows.length === 0) { res.status(404).json({ error: "No orders found" }); return; }

    // Validate same customer
    const uniqueCustomerIds = [...new Set(orderRows.map((o) => o.customerId))];
    if (uniqueCustomerIds.length > 1) {
      res.status(400).json({ error: "All orders must belong to the same customer" }); return;
    }

    const firstOrder = orderRows[0];
    const customerEmail = firstOrder.customerEmail ?? null;
    if (!customerEmail) { res.status(400).json({ error: "Customer has no email address on record" }); return; }

    // Block if customer requires a PO number but none is set on any order
    if (firstOrder.poNumberRequired && orderRows.every((o) => !o.poNumber)) {
      res.status(400).json({ error: "This customer requires a PO number before an invoice can be sent. Please add a PO number to the order(s) first." });
      return;
    }

    const poNumber = firstOrder.poNumber ?? null;
    // For multi-order consolidated invoices always join all order numbers so the
    // reference clearly identifies every order on the invoice.  For a single
    // order keep the legacy PO/… style when a PO number is present.
    const invoiceRef = orderRows.length === 1 && poNumber
      ? `PO/${poNumber}`
      : orderRows.map((o) => o.orderNumber).join("+");

    const customerLogoDataUrl = firstOrder.customerLogoUrl
      ? await fetchLogoDataUrl(firstOrder.customerLogoUrl).catch(() => null)
      : null;

    // Collect all items across orders, tagged with their orderRef
    const allItems: Array<{
      productName: string;
      colour: string | null;
      size: string | null;
      finishName: string | null;
      recipientName: string | null;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      vatRate: number;
      orderRef: string;
    }> = [];

    for (const order of orderRows) {
      const itemRows = await db
        .select({ item: orderItemsTable, employee: customerEmployeesTable })
        .from(orderItemsTable)
        .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
        .where(eq(orderItemsTable.orderId, order.id));

      for (const { item, employee } of itemRows) {
        const recipientName = employee
          ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") || null
          : (item.recipientName ?? null);
        allItems.push({
          productName: item.productName,
          colour: item.colour,
          size: item.size,
          finishName: item.finishName,
          recipientName,
          quantity: item.quantity,
          unitPrice: item.unitPrice as string,
          lineTotal: item.lineTotal as string,
          vatRate: parseFloat(item.vatRate as string),
          orderRef: order.orderNumber,
        });
      }
    }

    const totalAmount = orderRows.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? "0")), 0);
    // Use the single highest carriage among the orders — combined shipments have one shipping charge
    // Each linked fulfilment order represents a separate shipment/address.
    // Consolidating the accounting invoice must retain every shipment charge.
    const totalCarriage = orderRows.reduce(
      (sum, order) => sum + parseFloat(String(order.carriageAmount ?? "0")),
      0
    );

    const consolidatedZeroVat = firstOrder.zeroVat ?? false;

    // Generate consolidated PDF
    const pdfBuffer = await generateInvoicePDF({
      orderNumber: invoiceRef,
      customerName: firstOrder.customerName ?? "Customer",
      customerEmail,
      customerAddress: firstOrder.customerAddress,
      customerCity: firstOrder.customerCity,
      customerPostcode: firstOrder.customerPostcode,
      invoiceDate: new Date(),
      poNumber,
      carriageAmount: totalCarriage,
      zeroVat: consolidatedZeroVat,
      items: allItems,
      totalAmount: totalAmount.toFixed(2),
      notes: null,
    });

    // Build email
    const { subject, html, text } = buildInvoiceEmail({
      orderNumber: invoiceRef,
      customerName: firstOrder.customerName,
      contactFirstName: firstOrder.contactFirstName,
      customerLogoDataUrl,
      invoiceDate: new Date(),
      poNumber,
      carriageAmount: totalCarriage,
      zeroVat: consolidatedZeroVat,
      items: allItems.map((i) => ({
        ...i,
        unitPrice: parseFloat(i.unitPrice),
        lineTotal: parseFloat(i.lineTotal),
      })),
    });

    // Send email
    const safeName = invoiceRef.replace(/[/\\]/g, "-");
    const result = await sendEmail({
      to: customerEmail,
      subject,
      html,
      text,
      attachments: [{ filename: `Invoice-${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
    });

    if (!result.sent) throw new Error(result.error ?? "Failed to send email");

    // Mark all orders as invoiced
    await db
      .update(ordersTable)
      .set({ invoiceEmailSentAt: new Date(), invoiceEmailSentTo: customerEmail, updatedAt: new Date() })
      .where(inArray(ordersTable.id, orderIds));

    // Log action on each order
    for (const id of orderIds) {
      await logOrderAction(
        id,
        "Consolidated invoice sent",
        getActor(req),
        `Combined invoice ${invoiceRef} emailed to ${customerEmail} covering ${orderIds.length} order(s)`
      );
    }

    // Auto-post each order to Xero
    for (const id of orderIds) {
      try {
        const xeroPosted = await postInvoiceToXero(id);
        if ((xeroPosted as any).skippedZeroValue) {
          await logOrderAction(id, "Skipped Xero — zero value", getActor(req), "Invoice total is £0; not posted to Xero");
        } else if (xeroPosted.xeroInvoiceId) {
          await logOrderAction(id, "Posted to Xero", getActor(req), `Xero invoice ID: ${xeroPosted.xeroInvoiceId}`);
        }
      } catch (xeroErr) {
        const xeroMsg = xeroErr instanceof Error ? xeroErr.message : String(xeroErr);
        const notConnected = xeroMsg.includes("not connected") || xeroMsg.includes("No Xero tenant");
        if (!notConnected) {
          console.error(`[xero] Auto-post failed for consolidated order ${id}:`, xeroMsg);
          await logOrderAction(id, "Xero post failed", getActor(req), xeroMsg).catch(() => {});
        }
      }
    }

    res.json({ ok: true, sentTo: customerEmail, invoiceRef });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send consolidated invoice" });
  }
});

// ─── Refresh Stripe payment link (correct amount without re-sending email) ───

router.post("/invoices/:orderId/refresh-stripe-link", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, idParse.data));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.paidAt) { res.json({ ok: true, skipped: "already_paid", url: order.stripePaymentLinkUrl }); return; }

    const totalAmount = parseFloat(String(order.totalAmount ?? 0));
    const carriageAmount = parseFloat(String(order.carriageAmount ?? 0));
    const amountPence = Math.round((totalAmount + carriageAmount) * 100 * 1.2);

    if (amountPence <= 0) { res.status(400).json({ error: "Order total is zero — cannot create a payment link." }); return; }

    let stripeClient: Awaited<ReturnType<typeof getUncachableStripeClient>>;
    try { stripeClient = await getUncachableStripeClient(); } catch {
      res.status(503).json({ error: "Stripe is not configured on this account." }); return;
    }

    // Do NOT deactivate the existing link — it may be in a previously-sent acknowledgement
    // email. Deactivating would break that link for the customer. Multiple active links per
    // order are safe: any payment triggers the webhook and marks the order as paid.
    // (Amount-change deactivation already happens in the PATCH /orders/:id handler when
    // carriage is explicitly updated.)

    // Create fresh link with correct amount (items + carriage, inc. VAT)
    const price = await stripeClient.prices.create({
      unit_amount: amountPence,
      currency: "gbp",
      product_data: { name: `Order ${order.orderNumber}` },
    });
    const link = await stripeClient.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { order_id: String(idParse.data), order_number: order.orderNumber },
      after_completion: {
        type: "hosted_confirmation",
        hosted_confirmation: { custom_message: `Payment received for order ${order.orderNumber}. Thank you.` },
      },
    });

    await db.update(ordersTable)
      .set({ stripePaymentLinkUrl: link.url, stripePaymentLinkId: link.id, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));

    await logOrderAction(idParse.data, "Stripe link refreshed", getActor(req),
      `New link created for £${((amountPence) / 100).toFixed(2)} inc. VAT`);

    res.json({ ok: true, url: link.url, amountPence });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to refresh Stripe link" });
  }
});

// ─── Send invoice email ──────────────────────────────────────────────────────

router.post("/invoices/:orderId/send-email", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    // Block invoice send if customer requires a PO number but none is set
    const [orderCheck] = await db
      .select({ poNumber: ordersTable.poNumber, poNumberRequired: customersTable.poNumberRequired })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(eq(ordersTable.id, idParse.data));
    if (orderCheck?.poNumberRequired && !orderCheck?.poNumber) {
      res.status(400).json({ error: "This customer requires a PO number before an invoice can be sent. Please add a PO number to the order first." });
      return;
    }

    const { toEmail: toEmailOverride } = (req.body ?? {}) as { toEmail?: string };
    const result = await sendInvoiceEmail(idParse.data, toEmailOverride);

    await logOrderAction(idParse.data, "Invoice sent", getActor(req), `Invoice emailed to ${result.sentTo}`);

    // ── Local delivery: out-for-delivery notification + 48h follow-up schedule ─
    const [deliveryOrder] = await db
      .select({
        shippingMethod: ordersTable.shippingMethod,
        customerName: ordersTable.customerName,
        orderNumber: ordersTable.orderNumber,
        customerId: ordersTable.customerId,
        highLevelContactId: customersTable.highLevelContactId,
        customerEmail: customersTable.email,
        customerLogoUrl: customersTable.logoUrl,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(eq(ordersTable.id, idParse.data));

    {

      if (deliveryOrder?.shippingMethod === "local_delivery") {
        const actor = getActor(req);
        const actorName = actor !== "System" ? actor : null;

        // Resolve delivery templates from DB (with hardcoded fallbacks)
        const firstName = (deliveryOrder.customerName ?? "there").split(/\s/)[0];
        const tplVars = {
          firstName,
          orderNumber: deliveryOrder.orderNumber,
          customerName: deliveryOrder.customerName ?? "",
        };
        const [emailTpl, waTpl] = await Promise.all([
          getTemplate("delivery_notification_email"),
          getTemplate("delivery_notification_whatsapp"),
        ]);

        // 1. Send out-for-delivery notification email
        if (deliveryOrder.customerEmail) {
          try {
            const logoDataUrl = deliveryOrder.customerLogoUrl
              ? await fetchLogoDataUrl(deliveryOrder.customerLogoUrl)
              : null;
            const { html, text } = buildLocalDeliveryNotificationEmail({
              customerName: deliveryOrder.customerName ?? "there",
              orderNumber: deliveryOrder.orderNumber,
              customerLogoDataUrl: logoDataUrl,
            });
            const subject = emailTpl?.subject
              ? applyVars(emailTpl.subject, tplVars)
              : `Your ${deliveryOrder.orderNumber} order is out for delivery today 🚚`;
            await sendEmail({ to: deliveryOrder.customerEmail, subject, html, text });
          } catch (e) {
            console.error("[local-delivery] Notification email failed:", e);
          }
        }

        // 2. Fire GHL webhook for WhatsApp notification (non-blocking)
        const [webhookRow] = await db
          .select({ value: settingsTable.value })
          .from(settingsTable)
          .where(eq(settingsTable.key, "local_delivery_ghl_webhook_url"));
        if (webhookRow?.value && deliveryOrder.highLevelContactId) {
          const messageText = waTpl?.body ? applyVars(waTpl.body, tplVars) : undefined;
          void (async () => {
            await assertIntegrationOutboundAllowed("webhook");
            return fetch(webhookRow.value!, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventType: "out_for_delivery",
                contactId: deliveryOrder.highLevelContactId,
                orderNumber: deliveryOrder.orderNumber,
                customerName: deliveryOrder.customerName,
                ...(messageText ? { messageText } : {}),
              }),
            });
          })().catch((e) => console.error("[local-delivery] GHL webhook failed:", e));
        }

        // 3. Schedule 48-hour follow-up
        await db.execute(sql`
          UPDATE orders
          SET local_delivery_followup_due_at = now() + interval '48 hours',
              local_delivery_actor_name = ${actorName},
              updated_at = now()
          WHERE id = ${idParse.data}
        `);
        await logOrderAction(idParse.data, "Local delivery notification sent", actor,
          "Out-for-delivery email sent; 48h follow-up scheduled");
      }
    }

    // Auto-post to Xero
    let xeroResult: { xeroInvoiceId?: string; xeroInvoiceStatus?: string } = {};
    try {
      const xeroPosted = await postInvoiceToXero(idParse.data);
      xeroResult = { xeroInvoiceId: xeroPosted.xeroInvoiceId, xeroInvoiceStatus: xeroPosted.xeroInvoiceStatus };
      if ((xeroPosted as any).skippedZeroValue) {
        await logOrderAction(idParse.data, "Skipped Xero — zero value", getActor(req), "Invoice total is £0; not posted to Xero");
      } else if (xeroPosted.xeroInvoiceId) {
        await logOrderAction(idParse.data, "Posted to Xero", getActor(req), `Xero invoice ID: ${xeroPosted.xeroInvoiceId}`);
      }
    } catch (xeroErr) {
      const xeroMsg = xeroErr instanceof Error ? xeroErr.message : String(xeroErr);
      const notConnected = xeroMsg.includes("not connected") || xeroMsg.includes("No Xero tenant");
      if (!notConnected) {
        // Real API failure — log it visibly so staff know to retry
        console.error(`[xero] Auto-post failed for order ${idParse.data}:`, xeroMsg);
        await logOrderAction(idParse.data, "Xero post failed", getActor(req), xeroMsg).catch(() => {});
      }
      // Either way don't fail the invoice send
    }

    // ── Fire invoice_sent workflow ───────────────────────────────────────────
    fireWorkflow("invoice_sent", {
      order_number:    deliveryOrder?.orderNumber  ?? "",
      customer_name:   deliveryOrder?.customerName ?? "",
      contact_email:   deliveryOrder?.customerEmail ?? result.sentTo ?? null,
      contact_phone:   null,
      shipping_method: deliveryOrder?.shippingMethod ?? "",
      high_level_contact_id: deliveryOrder?.highLevelContactId ?? null,
    }).catch(() => {});

    res.json({ ok: true, sentTo: result.sentTo, ...xeroResult });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send invoice" });
  }
});

// ─── Mark invoice as sent without emailing (move directly to To Post to Xero) ─

router.post("/invoices/:orderId/mark-sent", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  try {
    const [order] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
      .from(ordersTable).where(eq(ordersTable.id, idParse.data));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    await db.update(ordersTable)
      .set({ invoiceEmailSentAt: new Date(), invoiceScheduledSendAt: null, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));
    await logOrderAction(idParse.data, "Invoice marked as sent (no email)", getActor(req), "Email skipped — posting to Xero");

    // Auto-post to Xero
    let xeroResult: { xeroInvoiceId?: string; xeroInvoiceStatus?: string } = {};
    try {
      const xeroPosted = await postInvoiceToXero(idParse.data);
      xeroResult = { xeroInvoiceId: xeroPosted.xeroInvoiceId, xeroInvoiceStatus: xeroPosted.xeroInvoiceStatus };
      if ((xeroPosted as any).skippedZeroValue) {
        await logOrderAction(idParse.data, "Skipped Xero — zero value", getActor(req), "Invoice total is £0; not posted to Xero");
      } else if (xeroPosted.xeroInvoiceId) {
        await logOrderAction(idParse.data, "Posted to Xero", getActor(req), `Xero invoice ID: ${xeroPosted.xeroInvoiceId}`);
      }
    } catch (xeroErr) {
      const xeroMsg = xeroErr instanceof Error ? xeroErr.message : String(xeroErr);
      const notConnected = xeroMsg.includes("not connected") || xeroMsg.includes("No Xero tenant");
      if (!notConnected) {
        console.error(`[xero] Auto-post failed for order ${idParse.data}:`, xeroMsg);
        await logOrderAction(idParse.data, "Xero post failed", getActor(req), xeroMsg).catch(() => {});
      }
    }

    // ── Fire invoice_sent workflow ───────────────────────────────────────────
    {
      const [orderCtx] = await db.execute(sql`
        SELECT o.order_number, o.customer_name, o.shipping_method,
               c.email AS customer_email, c.phone AS customer_phone,
               c.high_level_contact_id
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${idParse.data}
      `).then(r => r.rows as any[]);
      if (orderCtx) {
        fireWorkflow("invoice_sent", {
          order_number:    orderCtx.order_number   ?? "",
          customer_name:   orderCtx.customer_name  ?? "",
          contact_email:   orderCtx.customer_email ?? null,
          contact_phone:   orderCtx.customer_phone ?? null,
          shipping_method: orderCtx.shipping_method ?? "",
          high_level_contact_id: orderCtx.high_level_contact_id ?? null,
        }).catch(() => {});
      }
    }

    res.json({ ok: true, ...xeroResult });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to mark as sent" });
  }
});

// ─── Schedule / cancel scheduled invoice send ────────────────────────────────

router.patch("/invoices/:orderId/schedule", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  // scheduledSendAt is a plain "YYYY-MM-DD" date — the frontend no longer pre-converts it to a
  // UTC instant, since that baked in a fixed UTC offset and drifted an hour out during BST.
  const { scheduledSendAt, toEmail } = req.body as { scheduledSendAt: string | null; toEmail?: string };
  try {
    const val = scheduledSendAt ? londonWallTimeToUtc(scheduledSendAt, 9) : null;
    await db.update(ordersTable)
      .set({ invoiceScheduledSendAt: val, invoiceScheduleToEmail: val ? (toEmail?.trim() || null) : null, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));
    if (val) {
      await logOrderAction(idParse.data, "Invoice send scheduled", getActor(req),
        `Scheduled for ${val.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`);
    } else {
      await logOrderAction(idParse.data, "Invoice schedule cancelled", getActor(req));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// ─── Mark order as paid / unpaid ─────────────────────────────────────────────

router.patch("/invoices/:orderId/paid", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  const { paid } = req.body as { paid: boolean };
  try {
    await db.update(ordersTable)
      .set({ paidAt: paid ? new Date() : null, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));
    await logOrderAction(idParse.data, paid ? "Invoice marked as paid" : "Invoice marked as unpaid", getActor(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// ─── Preview invoice PDF (returns raw PDF) ───────────────────────────────────

router.get("/invoices/:orderId/preview-pdf", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  try {
    const { order, items, customerEmail, invoiceCustomerName, customerAddress, customerCity, customerPostcode, invoiceDeliveryGroups, zeroVat, deliveryAddressLines, deliveryLabel } = await buildInvoiceDataForOrder(idParse.data);
    const pdfBuffer = await generateInvoicePDF({
      orderNumber: order.orderNumber,
      xeroInvoiceNumber: order.xeroInvoiceNumber,
      customerName: invoiceCustomerName ?? order.customerName ?? "Customer",
      customerEmail,
      customerAddress,
      customerCity,
      customerPostcode,
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
      poNumber: order.poNumber,
      carriageAmount: parseFloat(String(order.carriageAmount ?? 0)),
      zeroVat,
      items: items.map((i) => ({
        productName: i.productName,
        colour: i.colour,
        size: i.size,
        finishName: i.finishName,
        recipientName: (i as any).employeeName ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice as string,
        lineTotal: i.lineTotal as string,
        vatRate: parseFloat(i.vatRate as string),
      })),
      totalAmount: order.totalAmount as string,
      notes: order.notes,
      deliveryGroups: invoiceDeliveryGroups,
      deliveryAddressLines,
      deliveryLabel,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Invoice-${order.orderNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate PDF" });
  }
});

// ─── Preview invoice email HTML ───────────────────────────────────────────────

router.get("/invoices/:orderId/preview-email", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  try {
    const { order, items, contactFirstName, customerLogoDataUrl, invoiceCustomerName, customerAddress, customerCity, customerPostcode, deliveryAddressLines, deliveryLabel, zeroVat } = await buildInvoiceDataForOrder(idParse.data);
    const mappedItems = items.map((i) => ({
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      finishName: i.finishName,
      quantity: i.quantity,
      unitPrice: parseFloat(i.unitPrice as string),
      lineTotal: parseFloat(i.lineTotal as string),
      vatRate: parseFloat(i.vatRate as string),
    }));
    const { subject, html } = buildInvoiceEmail({
      orderNumber: order.orderNumber,
      xeroInvoiceNumber: order.xeroInvoiceNumber,
      customerName: invoiceCustomerName ?? order.customerName,
      contactFirstName,
      customerLogoDataUrl,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddressLines,
      deliveryLabel,
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      notes: order.notes,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
      poNumber: order.poNumber,
      carriageAmount: parseFloat(String(order.carriageAmount ?? 0)),
      zeroVat,
      items: mappedItems,
    });
    res.json({ subject, html });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build preview" });
  }
});

// ─── Manually post to Xero ───────────────────────────────────────────────────

router.post("/invoices/:orderId/post-xero", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    const result = await postInvoiceToXero(idParse.data);
    if ((result as any).skippedZeroValue) {
      await logOrderAction(idParse.data, "Skipped Xero — zero value", getActor(req), "Invoice total is £0; archived locally without posting to Xero");
    } else if (result.xeroInvoiceId) {
      await logOrderAction(idParse.data, "Posted to Xero", getActor(req), `Xero invoice ID: ${result.xeroInvoiceId}`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to post to Xero" });
  }
});

// ─── Email status ─────────────────────────────────────────────────────────────

const isResendAvailable = !!(process.env.REPLIT_CONNECTORS_HOSTNAME);

router.get("/settings/email/status", async (_req, res): Promise<void> => {
  if (isResendAvailable) {
    res.json({ configured: true, provider: "resend", host: null, fromEmail: null });
    return;
  }
  const config = await getSmtpConfig();
  res.json({ configured: !!config, provider: "smtp", host: config?.host ?? null, fromEmail: config?.fromEmail ?? null });
});

// ─── Orders grouped by customer ──────────────────────────────────────────────

router.get("/invoices/by-customer", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      status: ordersTable.status,
      poNumber: ordersTable.poNumber,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      zeroVat: customersTable.zeroVat,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(
      inArray(ordersTable.status, ["shipped", "dispatched", "part_shipped"]),
      isNotNull(ordersTable.dispatchedAt),
    ))
    .orderBy(desc(ordersTable.dispatchedAt));

  const groupMap = new Map<string, {
    customerId: number | null;
    customerName: string | null;
    zeroVat: boolean;
    orders: typeof orders;
    totalEx: number;
    totalInc: number;
  }>();

  for (const o of orders) {
    const key = o.customerId ? String(o.customerId) : `name__${o.customerName ?? "unknown"}`;
    const zeroVat = o.zeroVat ?? false;
    if (!groupMap.has(key)) {
      groupMap.set(key, { customerId: o.customerId, customerName: o.customerName, zeroVat, orders: [], totalEx: 0, totalInc: 0 });
    }
    const g = groupMap.get(key)!;
    g.orders.push(o);
    const ex = parseFloat(String(o.totalAmount ?? 0));
    const carriage = parseFloat(String(o.carriageAmount ?? 0));
    g.totalEx += ex + carriage;
    g.totalInc += (ex + carriage) * (zeroVat ? 1 : 1.2);
  }

  res.json([...groupMap.values()].map((g) => ({
    ...g,
    totalEx: Math.round(g.totalEx * 100) / 100,
    totalInc: Math.round(g.totalInc * 100) / 100,
  })));
});

// ─── Orders grouped by customer PO number ────────────────────────────────────

router.get("/invoices/by-po-number", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      status: ordersTable.status,
      poNumber: ordersTable.poNumber,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      zeroVat: customersTable.zeroVat,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(isNotNull(ordersTable.poNumber))
    .orderBy(ordersTable.poNumber, desc(ordersTable.orderDate));

  // Group by poNumber + customer
  const groupMap = new Map<string, {
    poNumber: string;
    customerName: string | null;
    customerId: number | null;
    zeroVat: boolean;
    orders: typeof orders;
    totalEx: number;
    totalInc: number;
  }>();

  for (const o of orders) {
    const key = `${o.poNumber}__${o.customerId ?? "none"}`;
    const zeroVat = o.zeroVat ?? false;
    if (!groupMap.has(key)) {
      groupMap.set(key, { poNumber: o.poNumber!, customerName: o.customerName, customerId: o.customerId, zeroVat, orders: [], totalEx: 0, totalInc: 0 });
    }
    const g = groupMap.get(key)!;
    g.orders.push(o);
    const ex = parseFloat(String(o.totalAmount ?? 0));
    const carriage = parseFloat(String(o.carriageAmount ?? 0));
    g.totalEx += ex + carriage;
    g.totalInc += (ex + carriage) * (zeroVat ? 1 : 1.2);
  }

  res.json([...groupMap.values()].map((g) => ({
    ...g,
    totalEx: Math.round(g.totalEx * 100) / 100,
    totalInc: Math.round(g.totalInc * 100) / 100,
  })));
});

// ─── Send via High Level webhook ─────────────────────────────────────────────

router.post("/invoices/:orderId/send-highlevel", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const [row] = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      shippingMethod: ordersTable.shippingMethod,
      highLevelContactId: customersTable.highLevelContactId,
      customerEmail: customersTable.email,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(eq(ordersTable.id, idParse.data));

  if (!row) { res.status(404).json({ error: "Order not found" }); return; }
  if (!row.highLevelContactId) {
    res.status(400).json({ error: "Customer does not have a High Level contact ID set" });
    return;
  }

  const [webhookSetting] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "high_level_webhook_url"));

  const webhookUrl = webhookSetting?.value;
  if (!webhookUrl) {
    res.status(400).json({ error: "High Level webhook URL not configured in Settings" });
    return;
  }

  const totalInc = ((parseFloat(row.totalAmount ?? "0") + parseFloat(String(row.carriageAmount ?? 0))) * 1.2).toFixed(2);

  const payload = {
    contactId: row.highLevelContactId,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    totalAmountExVat: row.totalAmount,
    totalAmountIncVat: totalInc,
    customerEmail: row.customerEmail,
    shippingMethod: row.shippingMethod,
  };

  try {
    await assertIntegrationOutboundAllowed("webhook");
  } catch {
    res.status(423).json({ error: "Outbound webhook is not enabled for this installation." });
    return;
  }

  const hlRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!hlRes.ok) {
    const text = await hlRes.text().catch(() => "");
    res.status(502).json({ error: `High Level webhook returned ${hlRes.status}: ${text}` });
    return;
  }

  res.json({ ok: true, contactId: row.highLevelContactId, orderNumber: row.orderNumber });
});

router.post("/settings/email/test", async (req, res): Promise<void> => {
  const { to } = req.body ?? {};
  if (!to || typeof to !== "string" || !to.includes("@")) {
    res.status(400).json({ ok: false, error: "Provide a valid 'to' email address" });
    return;
  }
  try {
    const result = await sendEmail({
      to,
      subject: "Email test — delivery check",
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">Email delivery test</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Email Delivery Test</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 12px;font-size:15px;color:#374151;">✅ Email delivery is working correctly.</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">This is a test message sent from the Order Management System. If you received this, your email configuration is working correctly and staff login codes will be delivered to this inbox.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      text: `Email delivery test.\n\nIf you received this, email delivery is working correctly and staff login codes will be delivered to this inbox.`,
    });
    if (!result.sent) {
      res.status(500).json({ ok: false, error: result.error ?? "Email send failed", provider: result.provider });
      return;
    }
    console.log(`[email] Test email sent to ${to} via ${result.provider}, messageId=${result.messageId ?? "n/a"}`);
    res.json({ ok: true, provider: result.provider, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
  }
});

// ─── Test: send a review follow-up email immediately to a given address ────────
router.post("/invoices/test-followup-email", async (req, res): Promise<void> => {
  const { toEmail } = req.body ?? {};
  if (!toEmail || typeof toEmail !== "string") {
    res.status(400).json({ ok: false, error: "toEmail is required" });
    return;
  }
  try {
    // Pull review URLs from settings
    const rows = await db.execute(sql`
      SELECT key, value FROM settings
      WHERE key IN ('google_review_url', 'facebook_review_url')
    `);
    const sm: Record<string, string> = {};
    for (const r of rows.rows as any[]) sm[r.key] = r.value;

    const { html, text } = buildDeliveryFollowupEmail({
      customerName: "Test Customer",
      orderNumber: "TEST-001",
      actorName: null,
      googleReviewUrl: sm["google_review_url"] ?? null,
      facebookReviewUrl: sm["facebook_review_url"] ?? null,
      customerLogoDataUrl: null,
    });
    const result = await sendEmail({
      to: toEmail,
      subject: "Test: Review follow-up email",
      html,
      text,
    });
    if (!result.sent) {
      res.status(500).json({ ok: false, error: result.error ?? "Send failed" });
      return;
    }
    res.json({ ok: true, sentTo: toEmail });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
