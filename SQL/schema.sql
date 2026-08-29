-- ============================================================
-- Installationsintyg-portal — databasschema
-- Kör hela filen i Supabase SQL Editor (New query → Run)
-- ============================================================

-- ---------- TABELLER ----------------------------------------

create table if not exists public.organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  org_number   text not null unique,
  invite_code  text not null default substring(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_at   timestamptz not null default now()
);

create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  org_id           uuid references public.organizations(id) on delete cascade,
  full_name        text,
  role             text not null default 'member' check (role in ('owner', 'member')),
  is_global_admin  boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists public.certificates (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  created_by            uuid references public.profiles(id),
  status                text not null default 'utkast' check (status in ('utkast', 'klar')),
  -- Ett par indexerade fält för sök/lista i dashboarden. Resten av
  -- formuläret (alla ~80 fält) sparas samlat i form_data (jsonb) så att
  -- själva blanketten kan ändras utan att schemat behöver migreras.
  fastighetsbeteckning  text,
  kommun                text,
  installationsadress   text,
  anlaggningsdatum      date,
  form_data             jsonb not null default '{}'::jsonb,
  signature_data        text,  -- base64 PNG från signaturpaden
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.certificate_photos (
  id              uuid primary key default gen_random_uuid(),
  certificate_id  uuid not null references public.certificates(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  category_key    text not null,
  storage_path    text not null,
  uploaded_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_certificates_org on public.certificates(org_id);
create index if not exists idx_photos_certificate on public.certificate_photos(certificate_id);
create index if not exists idx_photos_org on public.certificate_photos(org_id);

-- ---------- updated_at-trigger --------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_certificates_updated_at on public.certificates;
create trigger trg_certificates_updated_at
  before update on public.certificates
  for each row execute function public.set_updated_at();

-- ---------- Hjälpfunktioner (SECURITY DEFINER, kringgår RLS) --

create or replace function public.my_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_global_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_global_admin from public.profiles where id = auth.uid()), false);
$$;

-- Skapa ny firma (körs av den första användaren i firman)
create or replace function public.create_organization(p_name text, p_org_number text, p_full_name text)
returns table(org_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_code text;
begin
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Kontot är redan kopplat till en firma.';
  end if;

  insert into public.organizations (name, org_number)
  values (p_name, p_org_number)
  returning id, invite_code into v_org_id, v_code;

  insert into public.profiles (id, org_id, full_name, role, is_global_admin)
  values (auth.uid(), v_org_id, p_full_name, 'owner', false);

  return query select v_org_id, v_code;
end;
$$;

-- Gå med i befintlig firma via org.nr + inbjudningskod (max 6 användare/firma)
create or replace function public.join_organization(p_org_number text, p_invite_code text, p_full_name text)
returns table(org_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_count int;
begin
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Kontot är redan kopplat till en firma.';
  end if;

  select id into v_org_id from public.organizations
  where org_number = p_org_number and invite_code = p_invite_code;

  if v_org_id is null then
    raise exception 'Fel organisationsnummer eller inbjudningskod.';
  end if;

  select count(*) into v_count from public.profiles where org_id = v_org_id;
  if v_count >= 6 then
    raise exception 'Firman har redan max antal användare (6 st).';
  end if;

  insert into public.profiles (id, org_id, full_name, role, is_global_admin)
  values (auth.uid(), v_org_id, p_full_name, 'member', false);

  return query select v_org_id;
end;
$$;

grant execute on function public.create_organization(text, text, text) to authenticated;
grant execute on function public.join_organization(text, text, text) to authenticated;
grant execute on function public.my_org_id() to authenticated;
grant execute on function public.is_global_admin() to authenticated;

-- ---------- ROW LEVEL SECURITY ---------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.certificates enable row level security;
alter table public.certificate_photos enable row level security;

-- organizations: man får se sin egen firma (eller alla, om global admin).
-- Inga direkta insert/update från klienten — det sker via RPC-funktionerna ovan.
drop policy if exists "org_select" on public.organizations;
create policy "org_select" on public.organizations
  for select using (public.is_global_admin() or id = public.my_org_id());

drop policy if exists "org_update_owner" on public.organizations;
create policy "org_update_owner" on public.organizations
  for update using (
    public.is_global_admin()
    or (id = public.my_org_id() and exists (
      select 1 from public.profiles where id = auth.uid() and role = 'owner'
    ))
  );

-- profiles: man ser kollegor i samma firma, eller alla om global admin.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id or public.is_global_admin());

-- certificates: bara egna firmans intyg, eller allt om global admin.
drop policy if exists "certificates_select" on public.certificates;
create policy "certificates_select" on public.certificates
  for select using (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "certificates_insert" on public.certificates;
create policy "certificates_insert" on public.certificates
  for insert with check (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "certificates_update" on public.certificates;
create policy "certificates_update" on public.certificates
  for update using (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "certificates_delete" on public.certificates;
create policy "certificates_delete" on public.certificates
  for delete using (public.is_global_admin() or org_id = public.my_org_id());

-- certificate_photos: samma mönster
drop policy if exists "photos_select" on public.certificate_photos;
create policy "photos_select" on public.certificate_photos
  for select using (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "photos_insert" on public.certificate_photos;
create policy "photos_insert" on public.certificate_photos
  for insert with check (public.is_global_admin() or org_id = public.my_org_id());

drop policy if exists "photos_delete" on public.certificate_photos;
create policy "photos_delete" on public.certificate_photos
  for delete using (public.is_global_admin() or org_id = public.my_org_id());

-- ---------- STORAGE (kör EFTER att du skapat bucketen "certificate-photos", privat) ----

drop policy if exists "cert_photos_select" on storage.objects;
create policy "cert_photos_select" on storage.objects
  for select using (
    bucket_id = 'certificate-photos'
    and (public.is_global_admin() or (storage.foldername(name))[1] = public.my_org_id()::text)
  );

drop policy if exists "cert_photos_insert" on storage.objects;
create policy "cert_photos_insert" on storage.objects
  for insert with check (
    bucket_id = 'certificate-photos'
    and (public.is_global_admin() or (storage.foldername(name))[1] = public.my_org_id()::text)
  );

drop policy if exists "cert_photos_delete" on storage.objects;
create policy "cert_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'certificate-photos'
    and (public.is_global_admin() or (storage.foldername(name))[1] = public.my_org_id()::text)
  );

-- ============================================================
-- Efter att du (André) registrerat ditt eget konto som vanlig
-- firmaanvändare, kör följande rad för att göra kontot till
-- global admin (ser alla firmors intyg):
--
--   update public.profiles set is_global_admin = true
--   where id = '<ditt-user-id-från-Authentication-fliken>';
-- ============================================================
