import { describe, expect, it, vi } from "vitest";

const identity = {
  name: "A&B <Uniform>",
  email: "help&team@example.test",
  phone: "+44 20 1234 5678",
};

vi.mock("../src/lib/business-config.js", () => ({
  getBusinessConfig: async () => identity,
  configuredBusinessName: () => identity.name,
  requireConfiguredBusinessIdentity: async () => identity,
}));

const { applyBusinessIdentityToEmail, generateOrderAcknowledgementPdf } =
  await import("../src/services/email.js");

describe("customer email business identity rendering", () => {
  it("uses persisted identity in text and safely escaped HTML", () => {
    const result = applyBusinessIdentityToEmail({
      html: '<header>Configured organisation</header><p>Contact details configured per installation</p><a href="" style="color:#111"></a>',
      text: "Contact details configured per installation\nThe configured organisation team",
    }, identity);

    expect(result.html).toContain("A&amp;B &lt;Uniform&gt;");
    expect(result.html).toContain("help&amp;team@example.test");
    expect(result.html).toContain('href="tel:+442012345678"');
    expect(result.html).not.toContain("Configured organisation");
    expect(result.text).toContain("help&team@example.test · +44 20 1234 5678");
    expect(result.text).toContain("The A&B <Uniform> team");
  });

  it("renders a PDF with the configured identity and without source placeholders", async () => {
    const pdf = await generateOrderAcknowledgementPdf({
      orderNumber: "TEST-42",
      orderDate: new Date("2025-01-01T00:00:00Z"),
      customerName: "Test Customer",
      items: [],
    });
    const rendered = pdf.toString("latin1");
    const decodedText = [...rendered.matchAll(/<([0-9a-f]{4,})>/gi)]
      .map((match) => Buffer.from(match[1], "hex").toString("latin1"))
      .join("");
    expect(rendered.startsWith("%PDF-")).toBe(true);
    expect(decodedText).toContain("A&B <Uniform>");
    expect(decodedText).not.toContain("Configured organisation");
    expect(decodedText).not.toContain("Contact details configured");
  });
});