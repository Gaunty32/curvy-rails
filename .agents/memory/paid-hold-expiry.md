---
name: Paid holds after expiry
description: How to handle a verified payment when its temporary component hold no longer protects stock.
---

If a payment succeeds after its checkout component hold expires or is released and the stock is no longer available, record the paid order and an explicit staff-review shortfall. Do not silently claim normal fulfillment, allocate nonexistent stock, or discard the paid order.

**Why:** Card confirmation can finish after a temporary reservation expires. Rejecting order recording at that point leaves a real payment without an order; silently treating it as normal creates an impossible fulfillment promise. This is an exceptional review state, not implicit permission to replenish a stock-only order.

**How to apply:** Any future payment finalization, status transition, or fulfillment process involving temporary holds must preserve this distinction and prevent ordinary confirmation until the exceptional shortfall is resolved through an explicit, audited decision.