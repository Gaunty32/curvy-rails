import { describe, expect, it } from "vitest";

process.env.PORTAL_JWT_SECRET ??= "business-identity-content-focused-test-secret";
const { buildInviteEmail } = await import("../src/routes/portal.js");

describe("portal invite business identity", () => {
  it("renders persisted business contact details and escapes identity in HTML", () => {
    const { html, text } = buildInviteEmail(
      "person@example.test",
      "https://portal.example.test/invite",
      "Customer",
      null,
      {
        name: "A&B <Uniform>",
        email: "help&team@example.test",
        phone: "+44 <123>",
      },
    );

    expect(html).toContain("A&amp;B &lt;Uniform&gt;");
    expect(html).toContain("help&amp;team@example.test");
    expect(html).toContain("+44 &lt;123&gt;");
    expect(html).not.toContain("Configured organisation");
    expect(html).not.toContain("configured-support@example.invalid");
    expect(text).toContain("A&B <Uniform> | help&team@example.test | +44 <123>");
    expect(text).not.toContain("configured-support@example.invalid");
  });
});