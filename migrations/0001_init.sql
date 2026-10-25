-- Each table mirrors one tab of the Google Sheet. `id` is the hidden _id column in the sheet.
-- Sync columns:
--   updated_at  ISO time of the last change on either side
--   sheet_hash  hash of the values last seen in (or written to) the sheet; NULL = never in the sheet
--   dirty       1 = changed in the app, not yet written to the sheet
--   deleted     1 = removed in the app, row still to be deleted from the sheet

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT,
  goal TEXT,
  package TEXT,
  price TEXT,
  last_payment TEXT,
  payment_status TEXT,
  schedule TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  sheet_hash TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX clients_name ON clients (name);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  date TEXT,
  client TEXT,
  focus TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  sheet_hash TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_client_date ON sessions (client, date);

CREATE TABLE strength (
  id TEXT PRIMARY KEY,
  date TEXT,
  client TEXT,
  workout TEXT,
  exercise TEXT,
  load_text TEXT,
  weight_kg REAL,
  sets_reps TEXT,
  updated_at TEXT NOT NULL,
  sheet_hash TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX strength_client_exercise ON strength (client, exercise, date);

-- Sync bookkeeping: last_pull_at, last_push_at, last_error, ...
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
