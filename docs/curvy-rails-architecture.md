# Curvy Rails — first-build boundary and proposed data model

This document describes a **proposal**, not an applied database migration. The
first build is a read-only demo API and a customer-facing prototype. All sample
people, products, orders, questions, photographs, wallet values and admin
metrics are fictional. No existing database contents, customer accounts, files,
integrations or external accounts are imported or changed.

## Isolation and rollout

- The new web artifact owns the Curvy Rails interface at `/`; the existing API
  server retains `/api`, with demo endpoints grouped at `/api/curvy-rails`.
  Existing routes remain untouched.
- Real accounts, writes, checkout, uploads and outbound messages are **not**
  enabled. Forms and privileged screens must be clearly labelled as demo-only.
- The project database currently has no application tables. Before adding
  persistence, review the current database, use a Curvy Rails-specific namespace,
  and migrate only the development database. Do not copy the original
  application's production database or migration flags.
- Keep future payment, communication and historical Whatnot-import adapters
  behind explicit configuration and activation gates. No credentials belong in
  source code.
- Never publish the prototype as a live shop until ownership, moderation,
  policies, consent, security, payments and catalogue content are approved.

## Proposed relational model

Identifiers should be stable opaque IDs; timestamps should be UTC. Monetary
amounts should be integer minor units with a currency, not floating-point
balances. Unique constraints and foreign keys are part of the future schema,
not optional application-side assumptions.

| Area | Proposed entities and key relationships |
| --- | --- |
| Identity | `User` holds an external authentication subject and status; `Profile` belongs to a user and keeps the optional Whatnot username private unless an explicit visibility choice is recorded; `Address` belongs to a user. Role assignments and community suspensions are separate from profile fields. |
| Catalogue | `Category` forms the navigation tree; `Product` belongs to one or more categories; `ProductVariant` holds SKU, colour, size label, price and active status; `Inventory` tracks stock per variant and location. Size values are data, never a fixed 16–32 rule. |
| Commerce | `Order` belongs to a customer; `OrderItem` snapshots product, variant, size, quantity and price at purchase; `Payment` belongs to an order and stores provider references/status only, never card details; `Shipment` belongs to an order and stores fulfilment status; promotions and delivery methods remain configurable. Future cart state is separate from confirmed orders. |
| Ownership | `VerifiedOwnership` links a customer to a specific order item and product after a trusted order or reviewed historical import. Source, verification date and provenance are recorded. A self-declared product claim must not create this record. |
| Product experience | `ProductExperience` references a product, author and verified ownership; optional fit and size details are voluntary. `ExperiencePhoto` references an experience, a private storage object path, explicit public-display consent and moderation status. Removing consent removes public visibility. |
| Questions | `ProductQuestion` references a product and a registered asker; `ProductAnswer` references a question and author. Verified-owner badges are derived from ownership records for the product, never a user-supplied flag. Reading remains public; asking requires a real account. |
| Safety | `HelpfulVote` uniquely identifies user, content type and content ID (one vote per member, no downvote). `ModerationReport` references reported content, reporter, reason and status. A separate moderation action audit records review, hide, rejection, removal and suspension. Negative feedback about a product is not automatically a policy violation. |
| Rewards | Versioned `RewardRule` defines amounts and limits. Append-only `StarTransaction` records each pending, awarded, reversed or redeemed event with an idempotency key and source contribution. `Wallet` is a derived view of the ledger, not an editable balance. `CreditTransaction` independently tracks issued/redeemed store credit in minor currency units. Reward reversals retain history. |
| Communications | `Notification` and `NotificationPreference` distinguish service messages from marketing. `ConsentRecord` is an append-only record of purpose, choice, text/version and timestamp. Future outbound automation consumes explicit events through an outbox, only after each automation is reviewed and enabled. |

## Enforcement rules for the later persistent build

1. Server-side authentication and role checks protect all customer and admin
   mutations. A demo account screen is never an authentication boundary.
2. Verified ownership is established by paid/qualified order-item provenance
   or a reviewed import, not by a checkbox or a frontend badge.
3. New photos stay private until consent and moderation allow publication.
   Apply file-type, size and image-processing checks before accepting uploads.
4. Rewards are issued once per eligible action. Moderation decisions and
   duplicate/rate-limit rules govern posting, award and reversal.
5. Payment, messaging and automation adapters default to off; activation of a
   site must not implicitly activate them.
6. Keep demo fixtures out of production seeds. Do not put private commercial
   terms, credentials, account IDs or real customer data into public assets.

## First-build route inventory

The prototype serves `/`, `/shop`, `/shop/women`, `/shop/men`, `/shop/new`,
`/product/:slug`, `/community`, `/join`, `/my-rail`, `/bag` and `/admin`.
Read-only demo API operations supply the homepage, catalogue, product detail,
community activity, sample account and sample admin overview. No mutation API
is provided in this phase.