-- =============================================================================
-- Public website v2 — trial requests (docs/WEBSITE.md)
--
-- The public "Request a 3-day free trial" form stores two more optional details
-- on access_requests:
--   city             the venue's city
--   preferred_genre  the catalogue genre the venue asked for (its name), or the
--                    word 'recommendation' when they asked us to suggest one
-- Both columns are nullable with no default, so existing rows are untouched and
-- the previous form keeps working while this version is reviewed. The existing
-- table grants and RLS policies on access_requests cover the new columns.
--
-- Apply after 20260926000100_frekvencija.sql. Target: Postgres 15 (hosted Supabase).
-- =============================================================================

begin;

alter table public.access_requests
  add column city text null
    check (city is null or (char_length(btrim(city)) >= 1 and char_length(city) <= 120)),
  add column preferred_genre text null
    check (
      preferred_genre is null
      or (char_length(btrim(preferred_genre)) >= 1 and char_length(preferred_genre) <= 80)
    );

comment on column public.access_requests.city is
  'City of the venue, from the public trial-request form.';
comment on column public.access_requests.preferred_genre is
  'Catalogue genre name the venue asked for, or ''recommendation'' when they asked for a suggestion.';

commit;
