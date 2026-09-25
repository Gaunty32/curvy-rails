import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertWooIntegrationAllowed, wooRequest } from "../services/woo-outbound.js";

const router = Router();

function extractFileUploads(metaData: any[]): { name: string; url: string }[] {
  const uploads: { name: string; url: string }[] = [];
  for (const m of metaData) {
    const rawValue = String(m.value || "");
    const displayValue = String(m.display_value || "");
    const displayKey = String(m.display_key || m.key || "Uploaded file");
    if (/^https?:\/\//i.test(rawValue)) {
      uploads.push({ name: displayKey, url: rawValue });
    } else if (/^https?:\/\//i.test(displayValue)) {
      uploads.push({ name: displayKey, url: displayValue });
    } else {
      const match = displayValue.match(/href=["']([^"']+)["']/i);
      if (match) uploads.push({ name: displayKey, url: match[1] });
    }
  }
  return uploads;
}

interface WooSettings {
  baseUrl: string;
  ck: string;
  cs: string;
}

export async function getWooSettings(): Promise<WooSettings | null> {
  const rows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('woo_url', 'woo_consumer_key', 'woo_consumer_secret')
  `);
  const map = Object.fromEntries((rows.rows as any[]).map((r: any) => [r.key, r.value]));
  if (!map["woo_url"] || !map["woo_consumer_key"] || !map["woo_consumer_secret"]) return null;
  return { baseUrl: map["woo_url"], ck: map["woo_consumer_key"], cs: map["woo_consumer_secret"] };
}

const WOO_TIMEOUT_MS = 10_000;

async function wooFetch<T>(settings: WooSettings, path: string): Promise<T> {
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);
  const res = await wooRequest(url.toString(), {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(WOO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

async function wooFetchPage<T>(
  settings: WooSettings,
  path: string
): Promise<{ data: T; totalPages: number }> {
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);
  const res = await wooRequest(url.toString(), {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(WOO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
  const totalPages = Math.max(1, Number(res.headers.get("x-wp-totalpages") || "1"));
  return { data: await res.json() as T, totalPages };
}

export async function wooUpdateOrderStatus(settings: WooSettings, wooOrderId: number, status: string): Promise<void> {
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders/${wooOrderId}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);
  const res = await wooRequest(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ status }),
    signal: AbortSignal.timeout(WOO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
}

// ─── Local dismiss helpers ────────────────────────────────────────────────────
async function getDismissedIds(): Promise<Set<number>> {
  const row = await db.execute(sql`SELECT value FROM settings WHERE key = 'woo_dismissed_ids' LIMIT 1`);
  if (row.rows.length === 0) return new Set();
  try { return new Set((JSON.parse((row.rows[0] as any).value) as number[])); } catch { return new Set(); }
}

async function addDismissedIds(ids: number[]): Promise<void> {
  const existing = await getDismissedIds();
  for (const id of ids) existing.add(id);
  const value = JSON.stringify([...existing]);
  await db.execute(sql`
    INSERT INTO settings (key, value) VALUES ('woo_dismissed_ids', ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

// ─── List recent WooCommerce orders ──────────────────────────────────────────
router.get("/woo/orders", async (req: Request, res: Response): Promise<void> => {
  const settings = await getWooSettings();
  if (!settings) {
    res.status(400).json({ error: "WooCommerce not configured. Check Settings → WooCommerce." });
    return;
  }

  try {
    const status = (req.query.status as string) || "processing,on-hold,pending";
    const page = parseInt(req.query.page as string) || 1;
    const perPage = 20;
    const path = `/orders?status=${status}&per_page=${perPage}&page=${page}&orderby=date&order=desc`;
    const wooOrders = await wooFetch<any[]>(settings, path);

    // Filter out locally dismissed orders
    const dismissedIds = await getDismissedIds();
    const filteredOrders = wooOrders.filter((o: any) => !dismissedIds.has(o.id));

    // Check which have already been imported
    const wooIds = filteredOrders.map((o: any) => o.id);
    let importedIds = new Set<number>();
    let importedMap = new Map<number, string>(); // wooId -> internal order number
    if (wooIds.length > 0) {
      const imported = await db.execute(
        sql.raw(`SELECT woo_order_id, order_number FROM orders WHERE woo_order_id IN (${wooIds.join(",")})`)
      );
      for (const r of imported.rows as any[]) {
        importedIds.add(Number(r.woo_order_id));
        importedMap.set(Number(r.woo_order_id), r.order_number);
      }
    }

    const orders = filteredOrders.map((o: any) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      dateCreated: o.date_created,
      customerNote: o.customer_note || null,
      billing: {
        firstName: o.billing?.first_name ?? "",
        lastName: o.billing?.last_name ?? "",
        company: o.billing?.company ?? "",
        email: o.billing?.email ?? "",
        phone: o.billing?.phone ?? "",
      },
      shipping: {
        firstName: o.shipping?.first_name ?? "",
        lastName: o.shipping?.last_name ?? "",
        company: o.shipping?.company ?? "",
        address1: o.shipping?.address_1 ?? "",
        address2: o.shipping?.address_2 ?? "",
        city: o.shipping?.city ?? "",
        postcode: o.shipping?.postcode ?? "",
        country: o.shipping?.country ?? "",
      },
      lineItems: (o.line_items ?? []).map((li: any) => {
        const fileUploads = extractFileUploads(li.meta_data ?? []);
        const fileUrls = new Set(fileUploads.map(f => f.url));
        return {
          id: li.id,
          name: li.name,
          sku: li.sku || null,
          quantity: li.quantity,
          price: li.price,
          total: li.total,
          metaData: (li.meta_data ?? []).filter((m: any) =>
            !m.key.startsWith("_") && m.display_value &&
            !fileUrls.has(String(m.display_value)) &&
            !/^https?:\/\//i.test(String(m.display_value))
          ).map((m: any) => ({ key: m.display_key || m.key, value: m.display_value })),
          fileUploads,
        };
      }),
      shippingLines: (o.shipping_lines ?? []).map((sl: any) => ({
        methodTitle: sl.method_title,
        total: sl.total,
      })),
      total: o.total,
      currency: o.currency,
      paymentMethodTitle: o.payment_method_title || null,
      alreadyImported: importedIds.has(o.id),
      importedOrderNumber: importedMap.get(o.id) ?? null,
    }));

    res.json({ orders, page, perPage });
  } catch (err: any) {
    console.error("[woo/orders] Error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Dismiss a single WooCommerce order locally (no WooCommerce write needed) ─
router.post("/woo/orders/:wooId/dismiss", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid WooCommerce order ID" }); return; }
  await addDismissedIds([wooId]);
  res.json({ ok: true });
});

// ─── Bulk dismiss WooCommerce orders locally ──────────────────────────────────
router.post("/woo/orders/dismiss-all", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { wooIds: number[] };
  if (!Array.isArray(body?.wooIds) || body.wooIds.length === 0) {
    res.status(400).json({ error: "wooIds array required" }); return;
  }
  await addDismissedIds(body.wooIds);
  res.json({ ok: true, dismissed: body.wooIds.length });
});

// ─── Import a WooCommerce order into the order system ────────────────────────
router.post("/woo/orders/:wooId/import", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid WooCommerce order ID" }); return; }

  const settings = await getWooSettings();
  if (!settings) {
    res.status(400).json({ error: "WooCommerce not configured." });
    return;
  }

  // Check not already imported
  const existing = await db.execute(sql`
    SELECT id, order_number FROM orders WHERE woo_order_id = ${wooId}
  `);
  if ((existing.rows as any[]).length > 0) {
    const row = existing.rows[0] as any;
    res.status(409).json({ error: `Already imported as ${row.order_number}`, orderNumber: row.order_number, orderId: row.id });
    return;
  }

  try {
    const woo = await wooFetch<any>(settings, `/orders/${wooId}`);

    // Determine customer name (billing company > full name)
    const billingName = [woo.billing?.first_name, woo.billing?.last_name].filter(Boolean).join(" ");
    const customerName = woo.billing?.company?.trim() || billingName || `WooCommerce #${woo.number}`;

    // Try to find matching customer in our DB by email or company name
    let customerId: number | null = null;
    const email = woo.billing?.email?.toLowerCase().trim();
    if (email) {
      const byEmail = await db.execute(sql`
        SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1
      `);
      if ((byEmail.rows as any[]).length > 0) {
        customerId = (byEmail.rows[0] as any).id;
      }
    }
    if (!customerId && woo.billing?.company) {
      const byName = await db.execute(sql`
        SELECT id FROM customers WHERE LOWER(name) = LOWER(${woo.billing.company.trim()}) LIMIT 1
      `);
      if ((byName.rows as any[]).length > 0) {
        customerId = (byName.rows[0] as any).id;
      }
    }

    // Generate the next order number
    const numRows = await db.execute(sql`
      SELECT order_number FROM orders
      WHERE order_number ~ '^O[0-9]+$'
      ORDER BY LENGTH(order_number) DESC, order_number DESC
      LIMIT 1
    `);
    const lastNum = (numRows.rows[0] as any)?.order_number as string | undefined;
    const orderNumber = `O${(lastNum ? parseInt(lastNum.slice(1), 10) : 99) + 1}`;

    // Calculate carriage from shipping lines
    const carriageAmount = (woo.shipping_lines ?? [])
      .reduce((sum: number, sl: any) => sum + parseFloat(sl.total || "0"), 0);

    // Collect all file uploads from line items + order meta
    const allFileUploads: { name: string; url: string }[] = [];
    for (const li of woo.line_items ?? []) {
      allFileUploads.push(...extractFileUploads(li.meta_data ?? []));
    }
    allFileUploads.push(...extractFileUploads(woo.meta_data ?? []));
    // Deduplicate by URL
    const seenUrls = new Set<string>();
    const dedupedFiles = allFileUploads.filter(f => {
      if (seenUrls.has(f.url)) return false;
      seenUrls.add(f.url);
      return true;
    });

    // Build notes
    const notesParts: string[] = [];
    if (woo.customer_note?.trim()) notesParts.push(`Customer note: ${woo.customer_note.trim()}`);
    if (woo.payment_method_title) notesParts.push(`Payment: ${woo.payment_method_title}`);

    // Store the WooCommerce order number for reference
    const wooOrderNumber = String(woo.number);
    if (wooOrderNumber && wooOrderNumber !== String(wooId)) {
      notesParts.push(`WooCommerce order #${wooOrderNumber}`);
    }

    const attachmentsJson = dedupedFiles.length > 0 ? JSON.stringify(dedupedFiles) : null;
    const orderResult = await db.execute(sql`
      INSERT INTO orders (
        order_number, customer_id, customer_name, status, total_amount,
        carriage_amount, notes, order_date, source, woo_order_id, attachments, created_at, updated_at
      ) VALUES (
        ${orderNumber},
        ${customerId},
        ${customerName},
        'draft',
        ${woo.total},
        ${carriageAmount.toFixed(2)},
        ${notesParts.join("\n") || null},
        ${woo.date_created ? new Date(woo.date_created).toISOString() : new Date().toISOString()},
        'woocommerce',
        ${wooId},
        ${attachmentsJson}::jsonb,
        now(), now()
      )
      RETURNING id, order_number
    `);
    const order = orderResult.rows[0] as any;

    // Import line items — try to match products by SKU
    for (const li of woo.line_items ?? []) {
      let productId: number | null = null;
      if (li.sku) {
        const prod = await db.execute(sql`
          SELECT id FROM products WHERE sku = ${li.sku} LIMIT 1
        `);
        if ((prod.rows as any[]).length > 0) productId = (prod.rows[0] as any).id;
      }

      // Extract colour/size from meta_data
      let colour: string | null = null;
      let size: string | null = null;
      const fileUploads = extractFileUploads(li.meta_data ?? []);
      const fileUrls = new Set(fileUploads.map((f: { url: string }) => f.url));
      const notesLines: string[] = [];
      for (const m of li.meta_data ?? []) {
        const key = (m.key || "").toLowerCase();
        const displayKey = m.display_key || m.key || "";
        const val = String(m.display_value || m.value || "").trim();
        if (!val || key.startsWith("_")) continue;
        if (key.includes("colour") || key.includes("color") || key.includes("pa_colour") || key.includes("pa_color")) { colour = val; continue; }
        if (key.includes("size") || key.includes("pa_size")) { size = val; continue; }
        if (fileUrls.has(val) || /^https?:\/\//i.test(val)) continue; // skip raw URLs
        if (/<[a-z][\s\S]*>/i.test(val)) continue; // skip HTML blobs
        notesLines.push(`${displayKey}: ${val}`);
      }
      const itemNotes = notesLines.length > 0 ? notesLines.join("\n") : null;

      const unitPrice = li.quantity > 0 ? (parseFloat(li.total || "0") / li.quantity).toFixed(2) : "0.00";
      await db.execute(sql`
        INSERT INTO order_items (
          order_id, product_id, product_name, colour, size,
          quantity, unit_price, line_total, recipient_type, notes
        ) VALUES (
          ${order.id},
          ${productId},
          ${li.name},
          ${colour},
          ${size},
          ${li.quantity},
          ${unitPrice},
          ${li.total},
          'stock',
          ${itemNotes}
        )
      `);
    }

    // Recalc total (includes carriage)
    await db.execute(sql`
      UPDATE orders SET
        total_amount = (
          SELECT COALESCE(SUM(line_total::numeric), 0) + ${carriageAmount}
          FROM order_items WHERE order_id = ${order.id}
        ),
        updated_at = now()
      WHERE id = ${order.id}
    `);

    // Log the import
    await db.execute(sql`
      INSERT INTO order_logs (order_id, action, actor, details, created_at)
      VALUES (${order.id}, 'Order imported', 'WooCommerce', ${`Imported from WooCommerce order #${woo.number}`}, now())
    `);

    res.status(201).json({ orderId: order.id, orderNumber: order.order_number, wooNumber: wooOrderNumber, customerName });
  } catch (err: any) {
    console.error("[woo/orders/:id/import] Error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Fetch a single WooCommerce order (for preview) ──────────────────────────
router.get("/woo/orders/:wooId", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  try {
    const woo = await wooFetch<any>(settings, `/orders/${wooId}`);
    res.json(woo);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Sync product guidance + gallery images from WooCommerce ─────────────────
// Fetches WC meta fields (_sbs_*) and gallery images for all products that
// have a woo_commerce_id, and updates the local DB.
router.post("/woo/sync/products-guidance", async (req: Request, res: Response): Promise<void> => {
  try {
    await assertWooIntegrationAllowed();
  } catch (err: any) {
    res.status(423).json({ error: err.message });
    return;
  }
  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  // Get products with WC IDs (paginated via query param ?limit=50&offset=0)
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit  as string) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  const productRows = await db.execute(sql`
    SELECT id, woo_commerce_id FROM products
    WHERE woo_commerce_id IS NOT NULL AND is_archived = false
    ORDER BY id
    LIMIT ${limit} OFFSET ${offset}
  `);
  const products = productRows.rows as any[];
  if (!products.length) { res.json({ synced: 0, total: 0, message: "No products to sync at this offset." }); return; }

  const totalRows = await db.execute(sql`SELECT COUNT(*) as n FROM products WHERE woo_commerce_id IS NOT NULL AND is_archived = false`);
  const total = Number((totalRows.rows[0] as any)?.n ?? 0);

  let synced = 0;
  const errors: string[] = [];

  const parseMeta = (metaData: any[], key: string): string =>
    (metaData ?? []).find((m: any) => m.key === key)?.value ?? "";

  for (const p of products) {
    try {
      const woo = await wooFetch<any>(settings, `/products/${p.woo_commerce_id}?_fields=id,images,meta_data,attributes`);
      const meta: any[] = woo.meta_data ?? [];

      // Extract guidance meta
      const valueRating     = parseInt(parseMeta(meta, "_sbs_value_rating"))      || 0;
      const durabilityRating= parseInt(parseMeta(meta, "_sbs_durability_rating")) || 0;
      const technicalRating = parseInt(parseMeta(meta, "_sbs_technical_rating"))  || 0;
      const bestFor         = parseMeta(meta, "_sbs_best_for");
      const notIdealFor     = parseMeta(meta, "_sbs_not_ideal_for");

      let badges: string[] = [];
      try { badges = JSON.parse(parseMeta(meta, "_sbs_badges_json") || "[]"); } catch {}
      let tags: string[] = [];
      try { tags = JSON.parse(parseMeta(meta, "_sbs_tags_json") || "[]"); } catch {}

      // Gallery images (all images from WC, not just main)
      const galleryImages = (woo.images ?? []).map((img: any) => img.src).filter(Boolean);

      // Size guide — try common meta keys used by various WC size-chart plugins
      const SIZE_GUIDE_KEYS = [
        "_sbs_size_guide",
        "_size_guide",
        "_size_chart",
        "_size_guide_html",
        "_woodmart_size_guide_id",
        "_berocket_size_chart_shortcode",
        "_alg_wc_sc_ids",
        "size_guide",
        "size_chart",
        "_woo_size_guide",
      ];
      let sizeGuideHtml: string | null = null;
      // First try known meta keys
      for (const key of SIZE_GUIDE_KEYS) {
        const val = parseMeta(meta, key).trim();
        if (val) { sizeGuideHtml = val; break; }
      }
      // Fallback: any meta key whose name contains "size_guide" or "size_chart"
      if (!sizeGuideHtml) {
        const fallback = (meta).find((m: any) =>
          /size[_-]?(guide|chart)/i.test(String(m.key ?? "")) && String(m.value ?? "").trim()
        );
        if (fallback) sizeGuideHtml = String(fallback.value).trim();
      }

      await db.execute(sql`
        UPDATE products SET
          guidance_value_rating      = ${valueRating || null},
          guidance_durability_rating = ${durabilityRating || null},
          guidance_smart_rating      = ${technicalRating || null},
          guidance_best_for          = ${bestFor || null},
          guidance_not_ideal_for     = ${notIdealFor || null},
          guidance_badges            = ${badges.length ? JSON.stringify(badges) : null}::jsonb,
          guidance_tags              = ${tags.length ? JSON.stringify(tags) : null}::jsonb,
          gallery_images             = ${galleryImages.length ? JSON.stringify(galleryImages) : null}::jsonb,
          size_guide_html            = ${sizeGuideHtml || null},
          updated_at                 = now()
        WHERE id = ${p.id}
      `);
      synced++;
    } catch (err: any) {
      errors.push(`Product ${p.id} (WC ${p.woo_commerce_id}): ${err.message}`);
    }
  }

  res.json({ synced, total, offset, limit, errors: errors.slice(0, 10), hasMore: offset + limit < total });
});

// ─── List WooCommerce customers ───────────────────────────────────────────────
router.get("/woo/customers", async (req: Request, res: Response): Promise<void> => {
  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  const page    = parseInt(req.query.page    as string) || 1;
  const perPage = Math.min(100, parseInt(req.query.per_page as string) || 50);
  const search  = (req.query.search as string) || "";

  try {
    let path = `/customers?per_page=${perPage}&page=${page}&orderby=registered_date&order=desc`;
    if (search) path += `&search=${encodeURIComponent(search)}`;

    const wooCustomers = await wooFetch<any[]>(settings, path);

    // Check which emails already exist in our customers table
    const emails = (wooCustomers as any[]).map((c: any) => c.email?.toLowerCase()).filter(Boolean);
    let existingEmails = new Set<string>();
    if (emails.length) {
      const existing = await db.execute(
        sql.raw(`SELECT LOWER(email) as email FROM customers WHERE LOWER(email) IN (${emails.map(e => `'${e.replace(/'/g, "''")}'`).join(",")})`)
      );
      existingEmails = new Set((existing.rows as any[]).map((r: any) => r.email));
    }

    const customers = (wooCustomers as any[]).map((c: any) => ({
      wooId:       c.id,
      email:       c.email,
      firstName:   c.first_name,
      lastName:    c.last_name,
      company:     c.billing?.company || "",
      phone:       c.billing?.phone   || "",
      address:     c.billing?.address_1 || "",
      city:        c.billing?.city    || "",
      postcode:    c.billing?.postcode || "",
      country:     c.billing?.country || "GB",
      registered:  c.date_created,
      orderCount:  c.orders_count ?? 0,
      totalSpent:  c.total_spent  ?? "0",
      alreadyImported: existingEmails.has((c.email || "").toLowerCase()),
    }));

    res.json({ customers, page, perPage });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Sync / import WooCommerce customers into internal customers table ─────────
router.post("/woo/customers/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    await assertWooIntegrationAllowed();
  } catch (err: any) {
    res.status(423).json({ error: err.message });
    return;
  }
  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  // Can either sync a list of WooCommerce IDs or every registered customer.
  const {
    wooIds,
    page = 1,
    perPage = 100,
    allPages = true,
  } = (req.body ?? {}) as {
    wooIds?: number[];
    page?: number;
    perPage?: number;
    allPages?: boolean;
  };

  let wooCustomers: any[];
  let source: "woocommerce" | "local_customers" = "woocommerce";
  let sourceWarning: string | null = null;
  try {
    if (wooIds?.length) {
      // Fetch specific customers by ID
      wooCustomers = await Promise.all(
        wooIds.map(id => wooFetch<any>(settings, `/customers/${id}`))
      );
    } else {
      const pageSize = Math.min(100, Math.max(1, perPage));
      const firstPage = Math.max(1, page);
      const first = await wooFetchPage<any[]>(
        settings,
        `/customers?per_page=${pageSize}&page=${firstPage}&orderby=registered_date&order=asc`
      );
      wooCustomers = [...first.data];

      if (allPages) {
        for (let currentPage = firstPage + 1; currentPage <= first.totalPages; currentPage++) {
          const next = await wooFetchPage<any[]>(
            settings,
            `/customers?per_page=${pageSize}&page=${currentPage}&orderby=registered_date&order=asc`
          );
          wooCustomers.push(...next.data);
        }
      }
    }
  } catch (err: any) {
    // Once the public domain points at the local shop, the retired WordPress API
    // may no longer be reachable. The earlier migration still left enough
    // customer data locally to create passwordless shop accounts safely.
    const localCustomers = await db.execute(sql`
      SELECT id, name, contact_first_name, contact_last_name, email, phone,
             address, city, state, postcode
      FROM customers
      WHERE email IS NOT NULL AND BTRIM(email) <> ''
      ORDER BY id
    `);
    wooCustomers = (localCustomers.rows as any[]).map((customer) => ({
      id: customer.id,
      email: customer.email,
      first_name: customer.contact_first_name,
      last_name: customer.contact_last_name,
      billing: {
        first_name: customer.contact_first_name,
        last_name: customer.contact_last_name,
        company: customer.name,
        phone: customer.phone,
        address_1: customer.address,
        city: customer.city,
        state: customer.state,
        postcode: customer.postcode,
        country: "GB",
      },
      _localCustomerFallback: true,
    }));
    source = "local_customers";
    sourceWarning = `WooCommerce could not be reached, so ${wooCustomers.length} previously migrated local customer records were used instead.`;
  }

  let created = 0;
  let skipped = 0;
  let shopAccountsCreated = 0;
  let shopAccountsUpdated = 0;
  let shopAccountsSkipped = 0;
  const errors: string[] = [];

  for (const c of wooCustomers as any[]) {
    const email = c.email?.toLowerCase().trim();
    const customerName = c.billing?.company?.trim() || `${c.first_name} ${c.last_name}`.trim() || c.email;

    try {
      // Keep the staff-facing customer list in sync.
      if (customerName) {
        let internalCustomerExists = false;
        if (email) {
          const existing = await db.execute(sql`SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1`);
          internalCustomerExists = (existing.rows as any[]).length > 0;
        }

        if (internalCustomerExists) {
          skipped++;
        } else {
          const contactFirstName = c.first_name?.trim() || null;
          const contactLastName  = c.last_name?.trim()  || null;

          await db.execute(sql`
            INSERT INTO customers (
              name, email, phone, address, city, postcode,
              contact_first_name, contact_last_name,
              created_at, updated_at
            ) VALUES (
              ${customerName},
              ${email || null},
              ${c.billing?.phone || null},
              ${c.billing?.address_1 || null},
              ${c.billing?.city || null},
              ${c.billing?.postcode || null},
              ${contactFirstName},
              ${contactLastName},
              now(), now()
            )
            ON CONFLICT DO NOTHING
          `);
          created++;
        }
      } else {
        skipped++;
      }

      // Registered WooCommerce customers use the local shop's email-code login.
      // WooCommerce password hashes are deliberately not copied.
      if (!email) {
        shopAccountsSkipped++;
        continue;
      }

      const existingShopAccount = await db.execute(sql`
        SELECT id FROM shop_customers WHERE LOWER(BTRIM(email)) = ${email} LIMIT 1
      `);
      const billing = c.billing ?? {};
      const firstName = c.first_name?.trim() || billing.first_name?.trim() || null;
      const lastName = c.last_name?.trim() || billing.last_name?.trim() || null;
      const wooCustomerId = c._localCustomerFallback ? null : Number(c.id);

      if ((existingShopAccount.rows as any[]).length > 0) {
        const shopCustomerId = (existingShopAccount.rows[0] as any).id;
        await db.execute(sql`
          UPDATE shop_customers SET
            first_name = COALESCE(NULLIF(first_name, ''), ${firstName}),
            last_name = COALESCE(NULLIF(last_name, ''), ${lastName}),
            company = COALESCE(NULLIF(company, ''), ${billing.company?.trim() || null}),
            phone = COALESCE(NULLIF(phone, ''), ${billing.phone?.trim() || null}),
            address_1 = COALESCE(NULLIF(address_1, ''), ${billing.address_1?.trim() || null}),
            address_2 = COALESCE(NULLIF(address_2, ''), ${billing.address_2?.trim() || null}),
            city = COALESCE(NULLIF(city, ''), ${billing.city?.trim() || null}),
            county = COALESCE(NULLIF(county, ''), ${billing.state?.trim() || null}),
            postcode = COALESCE(NULLIF(postcode, ''), ${billing.postcode?.trim() || null}),
            country = COALESCE(NULLIF(country, ''), ${billing.country?.trim() || "GB"}),
            woo_customer_id = COALESCE(woo_customer_id, ${wooCustomerId}),
            updated_at = now()
          WHERE id = ${shopCustomerId}
        `);
        shopAccountsUpdated++;
      } else {
        await db.execute(sql`
          INSERT INTO shop_customers (
            email, first_name, last_name, company, phone,
            address_1, address_2, city, county, postcode, country,
            woo_customer_id, created_at, updated_at
          ) VALUES (
            ${email}, ${firstName}, ${lastName}, ${billing.company?.trim() || null},
            ${billing.phone?.trim() || null}, ${billing.address_1?.trim() || null},
            ${billing.address_2?.trim() || null}, ${billing.city?.trim() || null},
            ${billing.state?.trim() || null}, ${billing.postcode?.trim() || null},
            ${billing.country?.trim() || "GB"}, ${wooCustomerId}, now(), now()
          )
        `);
        shopAccountsCreated++;
      }
    } catch (err: any) {
      errors.push(`WC customer ${c.id} (${email}): ${err.message}`);
    }
  }

  const linkedOrdersResult = await db.execute(sql`
    UPDATE orders o
    SET shop_customer_id = sc.id, updated_at = now()
    FROM customers c
    JOIN shop_customers sc
      ON LOWER(BTRIM(sc.email)) = LOWER(BTRIM(c.email))
    WHERE o.customer_id = c.id
      AND o.shop_customer_id IS NULL
  `);

  res.json({
    source,
    warning: sourceWarning,
    fetched: wooCustomers.length,
    created,
    skipped,
    shopAccountsCreated,
    shopAccountsUpdated,
    shopAccountsSkipped,
    linkedOrders: Number((linkedOrdersResult as any).rowCount ?? 0),
    errors: errors.slice(0, 10),
  });
});

// ─── Sync bundle definitions from WooCommerce ────────────────────────────────
// Fetches all yith_bundle products and upserts local bundles + bundle_components.
router.post("/woo/sync/bundles", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { runBundleSync } = await import("../services/woo-sync.js");
    const result = await runBundleSync();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
