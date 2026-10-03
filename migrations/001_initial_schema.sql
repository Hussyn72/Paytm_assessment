CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE seat_status AS ENUM ('available', 'confirmed');
CREATE TYPE reservation_status AS ENUM ('confirmed', 'cancelled');

CREATE TABLE shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_paise bigint NOT NULL CHECK (price_paise > 0),
  per_user_limit integer NOT NULL DEFAULT 4 CHECK (per_user_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  status reservation_status NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT reservations_cancelled_at_consistent CHECK (
    (status = 'confirmed' AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX reservations_show_user_idx ON reservations(show_id, user_id);

CREATE TABLE seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_number text NOT NULL,
  status seat_status NOT NULL DEFAULT 'available',
  reservation_id uuid REFERENCES reservations(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seats_show_seat_number_uq UNIQUE (show_id, seat_number),
  CONSTRAINT seats_reservation_state_consistent CHECK (
    (status = 'available' AND reservation_id IS NULL) OR
    (status = 'confirmed' AND reservation_id IS NOT NULL)
  )
);
CREATE INDEX seats_show_status_idx ON seats(show_id, status);

CREATE TABLE reservation_seats (
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
  PRIMARY KEY (reservation_id, seat_id)
);

CREATE TABLE user_show_inventory (
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  active_seat_count integer NOT NULL DEFAULT 0 CHECK (active_seat_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (show_id, user_id)
);

CREATE TABLE idempotency_keys (
  user_id text NOT NULL,
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE RESTRICT,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id, key)
);
