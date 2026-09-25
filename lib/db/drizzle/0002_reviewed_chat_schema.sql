-- Route-derived, schema-only chat support.  This adds structure only; it does
-- not copy conversations, messages, participants, preferences, or read receipts.
-- Apply after 0000_clean_bootstrap_v1.sql (and in the documented migration
-- sequence after 0001_reviewed_missing_tables.sql).

CREATE TABLE chat_conversations (
  id serial PRIMARY KEY,
  type text NOT NULL,
  order_id integer REFERENCES orders(id) ON DELETE SET NULL,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  subject text,
  created_by text,
  participants_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE INDEX chat_conversations_order_id_idx ON chat_conversations (order_id);
CREATE INDEX chat_conversations_customer_id_idx ON chat_conversations (customer_id);
CREATE INDEX chat_conversations_last_message_at_idx ON chat_conversations (last_message_at, created_at);

CREATE TABLE chat_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_conversation_created_idx
  ON chat_messages (conversation_id, created_at);

CREATE TABLE chat_participants (
  conversation_id integer NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_participants_pk PRIMARY KEY (conversation_id, user_name)
);

CREATE TABLE chat_message_reads (
  message_id integer NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_reads_pk PRIMARY KEY (message_id, user_name)
);

CREATE TABLE chat_notification_prefs (
  conversation_id integer NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  email text,
  notify_email boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX chat_notification_prefs_conversation_user_idx
  ON chat_notification_prefs (conversation_id, user_name);