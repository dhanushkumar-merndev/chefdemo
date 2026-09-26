begin;
-- One account, two sign-ins: email + password, and a mobile verified by OTP
-- (MSG91). A mobile signs in only once verified, and a verified mobile
-- belongs to one account. Members can sign up with either and add the other
-- in Profile.
--
-- Supabase's phone provider stays off. A member who signs up by mobile gets a
-- random internal Auth address ("phone-<uuid>@phone.invalid", never shown,
-- never deliverable) so the server can mint one-time sign-in tokens; their
-- profile email stays empty until they add and confirm a real one.

alter table public.profiles alter column email drop not null;
alter table public.profiles add column phone_verified boolean not null default false;

-- Replaces the non-unique lookup index: only verified mobiles sign in, and
-- each belongs to one member. Existing numbers start unverified.
drop index public.profiles_mobile_key;
create unique index profiles_verified_mobile on public.profiles(public.mobile_key(phone)) where phone_verified;

-- Server (service role) only, after MSG91 confirmed the member owns the mobile.
-- Serialized per mobile so two parallel requests cannot both claim a number.
create function public.set_verified_mobile(p_id uuid, p_phone text) returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := public.mobile_key(p_phone);
begin
  if v_key is null then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  perform pg_advisory_xact_lock(hashtext('mobile:' || v_key));
  if exists(select 1 from public.profiles where phone_verified and public.mobile_key(phone) = v_key and id <> p_id) then
    raise exception 'This mobile number is already used by another member'; end if;
  update public.profiles set phone = '+' || v_key, phone_verified = true where id = p_id;
  if not found then raise exception 'Member not found'; end if;
end $$;

-- Server only: a member who signed up by mobile has no profile email.
create function public.mark_phone_account(p_id uuid, p_phone text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_verified_mobile(p_id, p_phone);
  update public.profiles set email = null where id = p_id;
end $$;

-- Only verified mobiles sign in. Returns the Auth email (the internal address
-- for mobile-only members), which one-time sign-in tokens are minted for.
create or replace function public.sms_login_accounts(p_phone text) returns table(id uuid, email text) language sql stable security definer set search_path = '' as $$
  select p.id, u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.phone_verified and public.mobile_key(p_phone) is not null and public.mobile_key(p.phone) = public.mobile_key(p_phone)
  limit 2
$$;

-- The profile mobile is a contact field. Changing it drops verification (the
-- new number must be verified to sign in); a mobile-only member cannot change
-- it, since it is their only way in.
create or replace function public.save_profile(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_phone text := coalesce(trim(p_input->>'phone'),''); v_key text := public.mobile_key(p_input->>'phone'); v_same boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.role = 'chef' and (v_region = '' or v_location = '') then raise exception 'Select the region and location you work in'; end if;
  if (v_region <> '' or v_location <> '') and not exists(
    select 1 from public.service_areas where region = v_region and name = v_location and active
  ) then raise exception 'Choose a location from the list'; end if;
  if v_phone <> '' and v_key is null then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  v_same := v_key is not distinct from public.mobile_key(me.phone);
  if me.email is null and not v_same then raise exception 'Your mobile number is how you sign in, so it cannot be changed here'; end if;
  update public.profiles set name = trim(p_input->>'name'),
    phone = case when v_same then phone else left(v_phone,30) end,
    phone_verified = phone_verified and v_same,
    cuisine = left(p_input->>'cuisine',120),
    experience = (p_input->>'experience')::integer, online = (p_input->>'online')::boolean,
    region = left(v_region,80), location = left(v_location,80) where id = auth.uid();
end $$;

-- A mobile-only member who adds an email confirms it through Supabase's email
-- change; once Auth holds the confirmed address, the profile shows it too.
create function public.sync_profile_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email not like '%@phone.invalid' then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.sync_profile_email();

revoke execute on function public.set_verified_mobile(uuid,text), public.mark_phone_account(uuid,text), public.sync_profile_email() from public, anon, authenticated;
grant execute on function public.set_verified_mobile(uuid,text), public.mark_phone_account(uuid,text) to service_role;
revoke execute on function public.sms_login_accounts(text) from public, anon, authenticated;
grant execute on function public.sms_login_accounts(text) to service_role;
commit;
