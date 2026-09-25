-- Immutable, server-priced checkout facts for paid shop PaymentIntents.
-- Schema only: no business data or historical backfill.
-- Apply after 0004_reviewed_first_run_route_columns.sql.

CREATE TABLE shop_checkout_intents (
  payment_intent_id text PRIMARY KEY,
  original_cart_fingerprint text NOT NULL,
  amount_pence integer NOT NULL CHECK (amount_pence > 0),
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  order_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE INDEX shop_checkout_intents_order_id_idx ON shop_checkout_intents (order_id);