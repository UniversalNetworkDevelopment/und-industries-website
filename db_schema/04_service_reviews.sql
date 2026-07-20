-- 04_service_reviews.sql
-- Star ratings captured from the job-complete email. 2026-07-19.
--
-- The rating arrives as an unauthenticated GET (clicked from an email client, which carries
-- no session), so the table is written ONLY by the service role via the Worker. Nothing
-- client-side can insert, update, or read it.

CREATE TABLE IF NOT EXISTS public.service_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL,
  rating        smallint NOT NULL,
  comment       text,
  source        text NOT NULL DEFAULT 'email',
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_reviews_rating_chk CHECK (rating BETWEEN 1 AND 5)
);

-- One rating per ticket. Enforced in the DB as well as in the Worker, so a race between
-- two rapid clicks cannot produce two rows.
CREATE UNIQUE INDEX IF NOT EXISTS service_reviews_ticket_uniq
  ON public.service_reviews (ticket_number);

CREATE INDEX IF NOT EXISTS service_reviews_created_idx
  ON public.service_reviews (created_at DESC);

ALTER TABLE public.service_reviews ENABLE ROW LEVEL SECURITY;

-- NO policies are created, deliberately. With RLS enabled and no policy, anon and
-- authenticated can do NOTHING. Only the service_role key (server-side, in the Worker)
-- and the Supabase dashboard can touch it. A visitor must never be able to read other
-- customers' ratings or stuff the ballot.

COMMENT ON TABLE public.service_reviews IS
  'Star ratings from the job-complete email. Service-role writes only. One row per ticket.';

-- ── USEFUL QUERIES ──────────────────────────────────────────────────────────
-- Overall:
--   SELECT ROUND(AVG(rating),2) AS avg_rating, COUNT(*) AS reviews FROM service_reviews;
--
-- Distribution:
--   SELECT rating, COUNT(*) FROM service_reviews GROUP BY rating ORDER BY rating DESC;
--
-- Anything needing a reply (chase these first):
--   SELECT r.ticket_number, r.rating, r.created_at, t.service_slug
--   FROM service_reviews r
--   LEFT JOIN service_tickets t ON t.ticket_number = r.ticket_number
--   WHERE r.rating <= 3
--   ORDER BY r.created_at DESC;
