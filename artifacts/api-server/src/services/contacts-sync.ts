import { db, customersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { toDisplayCase } from "../lib/display-case.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

// ─── GoHighLevel ─────────────────────────────────────────────────────────────
// Pushes a customer's contact details to GHL (create or update).
// If the customer already has a highLevelContactId we PATCH that contact,
// otherwise we search GHL by email/phone and either link an existing contact
// or create a new one, storing the returned contact ID back on the customer.

export async function pushCustomerToHighLevel(customerId: number): Promise<void> {
  const apiKey    = await getSetting("high_level_api_key");
  const locationId = await getSetting("high_level_location_id");
  if (!apiKey || !locationId) return; // Not configured — skip silently
  await assertIntegrationOutboundAllowed("highlevel");

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) return;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };

  const payload: Record<string, unknown> = {
    firstName: toDisplayCase(customer.contactFirstName),
    lastName:  toDisplayCase(customer.contactLastName),
    email:     customer.email            ?? undefined,
    phone:     customer.phone            ?? undefined,
    companyName: toDisplayCase(customer.name),
    address1:  (customer as any).address ?? undefined,
    city:      customer.city             ?? undefined,
    state:     customer.state            ?? undefined,
    postalCode: (customer as any).postcode ?? undefined,
    locationId,
  };

  // Remove undefined keys
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  const existingContactId = customer.highLevelContactId;

  if (existingContactId) {
    // We already know the GHL contact — just update it
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/${existingContactId}`,
      { method: "PUT", headers, body: JSON.stringify(payload) }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[GHL] Failed to update contact ${existingContactId}: ${res.status} ${text}`);
    }
    return;
  }

  // ── Helper: extract a contact id from GHL search/duplicate response ──────
  function extractContactId(data: any): string | null {
    // /contacts/search/duplicate  → { contact: { id } }  or  { contacts: [{ id }] }
    // /contacts/ (search)         → { contacts: [{ id }] }
    if (data?.contact?.id) return data.contact.id;
    if (Array.isArray(data?.contacts) && data.contacts[0]?.id) return data.contacts[0].id;
    if (Array.isArray(data?.data) && data.data[0]?.id) return data.data[0].id;
    return null;
  }

  // ── Helper: link a found GHL contact and update it ────────────────────────
  async function linkAndUpdate(contactId: string): Promise<void> {
    await db.update(customersTable)
      .set({ highLevelContactId: contactId, updatedAt: new Date() })
      .where(eq(customersTable.id, customerId));
    await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { method: "PUT", headers, body: JSON.stringify(payload) }
    ).catch(() => {});
  }

  // ── 1. Search by email (duplicate endpoint) ───────────────────────────────
  if (customer.email) {
    try {
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(customer.email)}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const id = extractContactId(data);
        if (id) { await linkAndUpdate(id); return; }
      }
    } catch { /* fall through */ }
  }

  // ── 2. Search by phone (duplicate endpoint) ───────────────────────────────
  if (customer.phone) {
    try {
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&phone=${encodeURIComponent(customer.phone)}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const id = extractContactId(data);
        if (id) { await linkAndUpdate(id); return; }
      }
    } catch { /* fall through */ }
  }

  // ── 3. General contacts search by company name / email / phone ────────────
  const searchQuery = customer.email ?? customer.phone ?? customer.name;
  if (searchQuery) {
    try {
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(searchQuery)}&limit=5`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const contacts: any[] = data?.contacts ?? data?.data ?? [];
        // Find the best match: same email, or same phone
        const match = contacts.find((c: any) =>
          (customer.email && c.email?.toLowerCase() === customer.email.toLowerCase()) ||
          (customer.phone && (c.phone === customer.phone || c.phone?.replace(/\s/g, "") === customer.phone?.replace(/\s/g, "")))
        ) ?? null;
        if (match?.id) { await linkAndUpdate(match.id); return; }
      }
    } catch { /* fall through */ }
  }

  // ── 4. Nothing found — create a new GHL contact ───────────────────────────
  const createRes = await fetch(
    "https://services.leadconnectorhq.com/contacts/",
    { method: "POST", headers, body: JSON.stringify(payload) }
  );
  if (createRes.ok) {
    const data = await createRes.json() as any;
    const newContactId = data?.contact?.id ?? data?.id;
    if (newContactId) {
      await db.update(customersTable)
        .set({ highLevelContactId: newContactId, updatedAt: new Date() })
        .where(eq(customersTable.id, customerId));
    }
  } else {
    const text = await createRes.text().catch(() => "");
    console.error(`[GHL] Failed to create contact for customer ${customerId}: ${createRes.status} ${text}`);
  }
}

// ─── Invoco ───────────────────────────────────────────────────────────────────
// Pushes a customer's phone number + name to the Invoco phonebook so incoming
// calls show the customer name on the handset display.
// Auth priority:
//   1. Bearer token  — if invoco_api_key is set
//   2. HTTP Basic    — if invoco_username + invoco_password are set (legacy)
// Endpoint stored in settings as invoco_api_url.

export async function pushCustomerToInvoco(customerId: number): Promise<void> {
  const apiKey   = await getSetting("invoco_api_key");
  const username = await getSetting("invoco_username");
  const password = await getSetting("invoco_password");
  const apiUrl   = await getSetting("invoco_api_url");

  const hasApiKey   = !!apiKey;
  const hasBasicAuth = !!(username && password);
  if ((!hasApiKey && !hasBasicAuth) || !apiUrl) return; // Not configured — skip silently

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) return;

  const phone = customer.phone?.replace(/\s/g, "") ?? null;
  if (!phone) return; // No phone — nothing to push
  await assertIntegrationOutboundAllowed("invoco");

  const contactName = [customer.contactFirstName, customer.contactLastName]
    .filter(Boolean).join(" ") || customer.name;

  const authHeader = hasApiKey
    ? `Bearer ${apiKey}`
    : `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const body = JSON.stringify({
    Number: phone,
    Name: contactName,
    IsPrivate: false,
  });

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Invoco] Failed to push contact for customer ${customerId}: ${res.status} ${text}`);
  }
}

// ─── Combined helper ──────────────────────────────────────────────────────────
export async function syncCustomerToPhoneDirectory(customerId: number): Promise<void> {
  await Promise.allSettled([
    pushCustomerToHighLevel(customerId),
    pushCustomerToInvoco(customerId),
  ]);
}
