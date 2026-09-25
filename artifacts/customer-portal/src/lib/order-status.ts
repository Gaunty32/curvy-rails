export type PortalOrderLifecycle =
  | "pending_approval"
  | "pending_sbs"
  | "submitted"
  | "confirmed"
  | "part_shipped"
  | "shipped"
  | "delivered"
  | "rejected"
  | "unknown";

export function getPortalOrderLifecycle(
  status: string | null | undefined,
  portalStatus: string | null | undefined,
): PortalOrderLifecycle {
  const operationalStatus = status ?? "";
  const workflowStatus = portalStatus ?? "";

  // Fulfilment status must take precedence once the supplier has progressed the order.
  // portal_status records the portal approval workflow and commonly remains
  // "confirmed" after an order has been shipped or delivered.
  if (["delivered", "completed", "invoiced"].includes(operationalStatus)) return "delivered";
  if (operationalStatus === "shipped") return "shipped";
  if (operationalStatus === "part_shipped") return "part_shipped";
  if (operationalStatus === "cancelled" || workflowStatus === "rejected") return "rejected";

  if (workflowStatus === "pending_review") return "pending_approval";
  if (workflowStatus === "pending" || operationalStatus === "portal_pending") return "pending_sbs";
  if (workflowStatus === "submitted") return "submitted";
  if (workflowStatus === "confirmed" || operationalStatus === "confirmed" || operationalStatus === "draft") {
    return "confirmed";
  }

  return "unknown";
}