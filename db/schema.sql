-- One row per boss kill we have analysed.
CREATE TABLE IF NOT EXISTS kills (
  report_code          text        NOT NULL,
  fight_id             integer     NOT NULL,
  encounter_id         integer     NOT NULL,
  difficulty           text        NOT NULL CHECK (difficulty IN ('mythic', 'heroic')),
  guild_id             integer     NOT NULL,
  guild_name           text        NOT NULL,
  kill_date            timestamptz NOT NULL,
  duration_ms          integer     NOT NULL,
  healers              text[]      NOT NULL,
  -- 1 = guild's first kill of this boss on this difficulty; NULL = unknown
  kill_index           integer,
  first_kill_confirmed boolean     NOT NULL DEFAULT false,
  phases               jsonb       NOT NULL DEFAULT '[]',
  crawled_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_code, fight_id)
);
CREATE INDEX IF NOT EXISTS kills_boss_idx ON kills (encounter_id, difficulty, kill_date DESC);

CREATE TABLE IF NOT EXISTS casts (
  report_code  text    NOT NULL,
  fight_id     integer NOT NULL,
  spell_id     integer NOT NULL,
  source       text    NOT NULL,
  source_spec  text,
  timestamp_ms integer NOT NULL,
  FOREIGN KEY (report_code, fight_id) REFERENCES kills ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS casts_fight_idx ON casts (report_code, fight_id);

-- Ordered public kills per guild and boss. Never changes once found, so it's crawled once.
CREATE TABLE IF NOT EXISTS guild_kill_history (
  guild_id       integer NOT NULL,
  encounter_id   integer NOT NULL,
  difficulty     text    NOT NULL,
  kills          jsonb   NOT NULL, -- [{ "reportCode": "...", "fightId": 12 }, ...] oldest first
  first_confirmed boolean NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, encounter_id, difficulty)
);

-- Where each resumable rankings crawl got to, so the next run carries on from there.
CREATE TABLE IF NOT EXISTS crawl_pages (
  encounter_id integer NOT NULL,
  difficulty   text    NOT NULL,
  metric       text    NOT NULL,
  next_page    integer NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encounter_id, difficulty, metric)
);
