---
name: Inventory reconciliation safety
description: Why matching counted and current quantities is insufficient when approving a stocktake.
---

When approving a stocktake, treat *any* intervening inventory movement as making the draft stale, even if the final balance happens to match its original expected quantity. Reconciliation of an opening balance must precede draft stocktakes.

**Why:** A count can go from five to seven and back to five after a draft was recorded. Quantity-only checks accept that stale draft; allowing drafts before an opening balance can also block the initial reconciliation.

**How to apply:** For future component inventory and stocktake workflows, compare an immutable movement revision as well as the quantity, and require an established opening balance before drafting a count.