-- ============================================================
-- Migration 002 — GPS-position + stöd för offline-synk
-- Kör i Supabase SQL Editor EFTER sql/schema.sql.
-- Säker att köra flera gånger (allt är "IF NOT EXISTS").
-- ============================================================

-- GPS-position för installationsplatsen
alter table public.certificates add column if not exists gps_lat double precision;
alter table public.certificates add column if not exists gps_lng double precision;
alter table public.certificates add column if not exists gps_accuracy_m double precision;

-- client_id: genereras i appen (offline-säkert, oberoende av server-id).
-- Gör att samma sparning kan skickas flera gånger (t.ex. vid synk efter
-- att ha varit offline) utan att skapa dubbletter — vi upsertar på denna
-- kolumn istället för på den vanliga primärnyckeln.
alter table public.certificates add column if not exists client_id uuid;
create unique index if not exists idx_certificates_client_id
  on public.certificates(client_id) where client_id is not null;

alter table public.certificate_photos add column if not exists client_id uuid;
create unique index if not exists idx_photos_client_id
  on public.certificate_photos(client_id) where client_id is not null;
