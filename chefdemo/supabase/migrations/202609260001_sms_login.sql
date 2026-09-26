begin;
-- SMS (MSG91 OTP widget) login. A verified mobile signs into the existing
-- account whose profile carries that number; email stays the account identity.

-- Canonical Indian mobile ("919876543210") from free-text input, or null.
-- Matches normalizeMobile in src/lib/phone.ts.
create function public.mobile_key(p_phone text) returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^[6-9][0-9]{9}$' then '91' || d
    when d ~ '^0[6-9][0-9]{9}$' then '91' || substr(d, 2)
    when d ~ '^91[6-9][0-9]{9}$' then d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x
$$;
-- Login looks a profile up by mobile: an index probe, not a scan of profiles.
-- Not unique, so existing duplicate numbers do not block this migration; the
-- login refuses an ambiguous number and save_profile prevents new duplicates.
create index profiles_mobile_key on public.profiles(public.mobile_key(phone)) where public.mobile_key(phone) is not null;

-- Profile mobile must be a valid Indian mobile (or blank) and not used by another member.
create or replace function public.save_profile(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_phone text := coalesce(trim(p_input->>'phone'),''); v_key text := public.mobile_key(p_input->>'phone');
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'chef' and (v_region = '' or v_location = '') then raise exception 'Select the region and location you work in'; end if;
  if (v_region <> '' or v_location <> '') and not exists(
    select 1 from public.service_areas where region = v_region and name = v_location and active
  ) then raise exception 'Choose a location from the list'; end if;
  if v_phone <> '' and v_key is null then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  if v_key is not null and exists(select 1 from public.profiles where public.mobile_key(phone) = v_key and id <> auth.uid()) then
    raise exception 'This mobile number is already used by another member'; end if;
  update public.profiles set name = trim(p_input->>'name'), phone = left(v_phone,30), cuisine = left(p_input->>'cuisine',120),
    experience = (p_input->>'experience')::integer, online = (p_input->>'online')::boolean,
    region = left(v_region,80), location = left(v_location,80) where id = auth.uid();
end $$;

-- Accounts for a verified mobile. Returns up to two rows so the caller can
-- refuse an ambiguous number instead of picking one. Server (service role) only.
create function public.sms_login_accounts(p_phone text) returns table(id uuid, email text) language sql stable security definer set search_path = '' as $$
  select p.id, p.email from public.profiles p
  where public.mobile_key(p_phone) is not null and public.mobile_key(p.phone) = public.mobile_key(p_phone)
  limit 2
$$;

-- Each MSG91 access token opens at most one session.
create table public.sms_login_receipts (
  token_hash text primary key,
  used_at timestamptz not null default now()
);
create index sms_login_receipts_used_at on public.sms_login_receipts(used_at);
alter table public.sms_login_receipts enable row level security;
revoke all on public.sms_login_receipts from anon, authenticated;

-- True the first time a token is seen. Prunes receipts older than a day
-- (MSG91 tokens are short-lived) so the table stays small.
create function public.claim_sms_login(p_token_hash text) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  delete from public.sms_login_receipts where used_at < now() - interval '1 day';
  insert into public.sms_login_receipts(token_hash) values(p_token_hash) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end $$;

revoke execute on function public.sms_login_accounts(text), public.claim_sms_login(text) from public, anon, authenticated;
grant execute on function public.sms_login_accounts(text), public.claim_sms_login(text) to service_role;
commit;
