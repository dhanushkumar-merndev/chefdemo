-- Run once in a new Supabase project's SQL editor.
begin;
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  email text not null unique,
  role text not null default 'chef' check(role in ('admin','manager','chef')),
  phone text not null default '', cuisine text not null default '',
  experience integer not null default 0 check(experience between 0 and 80),
  online boolean not null default true
);
create table public.staff_access (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  name text not null, role text not null check(role in ('admin','manager','chef'))
);
create table public.dishes (
  id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
  cuisine text not null, vegetarian boolean not null default true, active boolean not null default true
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(), chef_id uuid not null references public.profiles,
  customer text not null check(length(trim(customer)) between 1 and 120),
  service text not null check(length(trim(service)) between 1 and 160), address text not null check(length(trim(address)) > 0),
  guests integer not null check(guests between 1 and 500),
  scheduled_start timestamptz not null, scheduled_end timestamptz not null,
  actual_in timestamptz, actual_out timestamptz,
  status text not null default 'requested' check(status in ('requested','upcoming','in_progress','completed','cancelled')),
  base_amount numeric(12,2) not null check(base_amount between 0 and 1000000),
  overtime_rate numeric(12,2) not null check(overtime_rate between 0 and 1000000),
  overtime_amount numeric(12,2) not null default 0 check(overtime_amount >= 0),
  dish_ids uuid[] not null default '{}', notes text not null default '',
  check(scheduled_end > scheduled_start), check(actual_out is null or actual_out >= actual_in)
);
create unique index one_active_service on public.bookings(chef_id) where status = 'in_progress';
create index bookings_chef_schedule on public.bookings(chef_id, scheduled_start);
create table public.service_photos (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings on delete cascade,
  stage text not null check(stage in ('entry','before','preparing','after')), path text not null,
  created_at timestamptz not null default now(), unique(booking_id,stage)
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings,
  customer text not null, rating integer not null check(rating between 1 and 5), comment text not null
);
create table public.tickets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles,
  subject text not null check(length(trim(subject)) between 1 and 160), message text not null check(length(trim(message)) between 1 and 4000),
  status text not null default 'open' check(status in ('open','resolved')), created_at timestamptz not null default now()
);

create function public.my_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;
create function public.can_access_booking(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.bookings where id = p_id and (chef_id = auth.uid() or public.my_role() in ('admin','manager')))
$$;
create function public.can_edit_photo(p_id uuid, p_stage text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.bookings where id = p_id and public.can_access_booking(id)
    and status in ('upcoming','in_progress') and (p_stage in ('entry','before') or status = 'in_progress'))
$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare access_record public.staff_access;
begin
  select * into access_record from public.staff_access where email = lower(new.email) for update;
  insert into public.profiles(id,name,email,role) values(new.id,
    coalesce(access_record.name, nullif(left(trim(new.raw_user_meta_data->>'name'),120),''), split_part(new.email,'@',1)),
    lower(new.email), coalesce(access_record.role,'chef'));
  delete from public.staff_access where email = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.staff_access enable row level security;
alter table public.dishes enable row level security;
alter table public.bookings enable row level security;
alter table public.service_photos enable row level security;
alter table public.reviews enable row level security;
alter table public.tickets enable row level security;
revoke all on public.profiles, public.staff_access, public.dishes, public.bookings, public.service_photos, public.reviews, public.tickets from anon, authenticated;
grant select on public.profiles, public.staff_access, public.dishes, public.bookings, public.service_photos, public.reviews, public.tickets to authenticated;
grant insert, update on public.dishes, public.service_photos to authenticated;
grant insert on public.tickets to authenticated;
grant update(status) on public.tickets to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id = auth.uid() or public.my_role() in ('admin','manager'));
create policy staff_read on public.staff_access for select to authenticated using(public.my_role() = 'admin');
create policy dishes_read on public.dishes for select to authenticated using(true);
create policy dishes_insert on public.dishes for insert to authenticated with check(public.my_role() in ('admin','manager'));
create policy dishes_update on public.dishes for update to authenticated using(public.my_role() in ('admin','manager')) with check(public.my_role() in ('admin','manager'));
create policy bookings_read on public.bookings for select to authenticated using(chef_id = auth.uid() or public.my_role() in ('admin','manager'));
create policy photos_read on public.service_photos for select to authenticated using(public.can_access_booking(booking_id));
create policy photos_insert on public.service_photos for insert to authenticated with check(public.can_edit_photo(booking_id,stage));
create policy photos_update on public.service_photos for update to authenticated using(public.can_edit_photo(booking_id,stage)) with check(public.can_edit_photo(booking_id,stage));
create policy reviews_read on public.reviews for select to authenticated using(public.can_access_booking(booking_id));
create policy tickets_read on public.tickets for select to authenticated using(user_id = auth.uid() or public.my_role() in ('admin','manager'));
create policy tickets_insert on public.tickets for insert to authenticated with check(user_id = auth.uid() and status = 'open');
create policy tickets_resolve on public.tickets for update to authenticated using(public.my_role() in ('admin','manager')) with check(public.my_role() in ('admin','manager'));

create function public.booking_action(p_id uuid, p_action text, p_dishes uuid[] default '{}') returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_now timestamptz := clock_timestamp();
begin
  if not public.can_access_booking(p_id) then raise exception 'Booking not found or access denied'; end if;
  select * into b from public.bookings where id = p_id for update;
  if p_action in ('accept','reject') then
    if b.status <> 'requested' then raise exception 'This request has already been handled'; end if;
    update public.bookings set status = case when p_action = 'accept' then 'upcoming' else 'cancelled' end where id = p_id;
  elsif p_action = 'cancel' then
    if public.my_role() not in ('admin','manager') or public.my_role() is null then raise exception 'Manager access required'; end if;
    if b.status not in ('requested','upcoming') then raise exception 'Only unstarted bookings can be cancelled'; end if;
    update public.bookings set status = 'cancelled' where id = p_id;
  elsif p_action = 'save_dishes' then
    if b.status not in ('requested','upcoming','in_progress') then raise exception 'This menu is locked'; end if;
    if coalesce(cardinality(p_dishes),0) = 0 or exists(select 1 from unnest(p_dishes) x where not exists(select 1 from public.dishes d where d.id = x and d.active)) then raise exception 'Select at least one active dish'; end if;
    update public.bookings set dish_ids = array(select distinct unnest(p_dishes)) where id = p_id;
  elsif p_action = 'check_in' then
    if b.status <> 'upcoming' then raise exception 'Only an upcoming service can be started'; end if;
    if cardinality(b.dish_ids) = 0 then raise exception 'Select your dishes before checking in'; end if;
    if (select count(*) from public.service_photos where booking_id = p_id and stage in ('entry','before')) <> 2 then raise exception 'Upload entry and kitchen-before photos before checking in'; end if;
    if exists(select 1 from public.bookings where chef_id = b.chef_id and status = 'in_progress') then raise exception 'Complete your active service first'; end if;
    update public.bookings set actual_in = v_now, status = 'in_progress' where id = p_id;
  elsif p_action = 'complete' then
    if b.status <> 'in_progress' then raise exception 'Check in before completing a service'; end if;
    if cardinality(b.dish_ids) = 0 or (select count(*) from public.service_photos where booking_id = p_id) <> 4 then raise exception 'Select dishes and upload all four kitchen photos to complete the service'; end if;
    update public.bookings set actual_out = v_now, status = 'completed',
      overtime_amount = round(greatest(0,ceil(extract(epoch from(v_now - scheduled_end))/60)) * overtime_rate / 60, 2) where id = p_id;
  else raise exception 'Unknown booking action'; end if;
end $$;

create function public.create_booking(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_chef uuid := (p_input->>'chef_id')::uuid; v_dishes uuid[];
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  perform 1 from public.profiles where id = v_chef and role = 'chef' for update;
  if not found then raise exception 'Select a chef'; end if;
  if exists(select 1 from public.bookings where chef_id = v_chef and status not in ('completed','cancelled') and scheduled_start < (p_input->>'scheduled_end')::timestamptz and scheduled_end > (p_input->>'scheduled_start')::timestamptz) then raise exception 'This chef already has a booking during these timings'; end if;
  v_dishes := array(select jsonb_array_elements_text(coalesce(p_input->'dish_ids','[]'))::uuid);
  if exists(select 1 from unnest(v_dishes) x where not exists(select 1 from public.dishes where id = x and active)) then raise exception 'Select active dishes'; end if;
  insert into public.bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,base_amount,overtime_rate,dish_ids,notes)
  values(v_chef,trim(p_input->>'customer'),trim(p_input->>'service'),trim(p_input->>'address'),(p_input->>'guests')::integer,
    (p_input->>'scheduled_start')::timestamptz,(p_input->>'scheduled_end')::timestamptz,(p_input->>'base_amount')::numeric,
    (p_input->>'overtime_rate')::numeric,v_dishes,coalesce(p_input->>'notes',''));
end $$;
create function public.save_profile(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.profiles set name = trim(p_input->>'name'), phone = left(p_input->>'phone',30), cuisine = left(p_input->>'cuisine',120),
    experience = (p_input->>'experience')::integer, online = (p_input->>'online')::boolean where id = auth.uid();
end $$;
create function public.authorize_staff(p_name text,p_email text,p_role text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
  if length(trim(p_name)) not between 1 and 120 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid name and email'; end if;
  if exists(select 1 from public.profiles where email = lower(trim(p_email))) then raise exception 'This email is already registered'; end if;
  insert into public.staff_access(name,email,role) values(trim(p_name),lower(trim(p_email)),p_role);
end $$;
create function public.set_staff_role(p_id uuid,p_role text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own administrator role'; end if;
  perform 1 from public.profiles where id = p_id for update;
  if not found then raise exception 'Staff member not found'; end if;
  if p_role <> 'chef' and exists(select 1 from public.bookings where chef_id = p_id and status in ('requested','upcoming','in_progress')) then raise exception 'Finish or cancel open bookings before changing this role'; end if;
  update public.profiles set role = p_role where id = p_id;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kitchen-photos','kitchen-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy kitchen_read on storage.objects for select to authenticated using(
  bucket_id = 'kitchen-photos' and exists(select 1 from public.bookings b where b.id::text = split_part(name,'/',1) and public.can_access_booking(b.id))
);
create policy kitchen_upload on storage.objects for insert to authenticated with check(
  bucket_id = 'kitchen-photos' and split_part(name,'/',2) in ('entry','before','preparing','after')
  and exists(select 1 from public.bookings b where b.id::text = split_part(name,'/',1) and public.can_edit_photo(b.id,split_part(name,'/',2)))
);
create policy kitchen_cleanup on storage.objects for delete to authenticated using(
  bucket_id = 'kitchen-photos' and owner_id = auth.uid()::text
  and not exists(select 1 from public.service_photos p where p.path = name)
);
create function public.validate_photo_record() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize photo updates with checkout so completed evidence cannot change.
  perform 1 from public.bookings where id = new.booking_id for update;
  if not public.can_edit_photo(new.booking_id,new.stage) then raise exception 'Photo updates are locked for this service'; end if;
  if tg_op = 'UPDATE' and (new.booking_id <> old.booking_id or new.stage <> old.stage) then raise exception 'Photo identity cannot be changed'; end if;
  if split_part(new.path,'/',1) <> new.booking_id::text or split_part(new.path,'/',2) <> new.stage
    or not exists(select 1 from storage.objects where bucket_id = 'kitchen-photos' and name = new.path) then raise exception 'Upload the photo before saving it'; end if;
  new.created_at := clock_timestamp();
  return new;
end $$;
create trigger validate_photo before insert or update on public.service_photos for each row execute function public.validate_photo_record();

revoke execute on function public.handle_new_user(), public.validate_photo_record() from public, anon, authenticated;
revoke execute on function public.my_role(), public.can_access_booking(uuid), public.can_edit_photo(uuid,text), public.booking_action(uuid,text,uuid[]), public.create_booking(jsonb), public.save_profile(jsonb), public.authorize_staff(text,text,text), public.set_staff_role(uuid,text) from public, anon;
grant execute on function public.my_role(), public.can_access_booking(uuid), public.can_edit_photo(uuid,text), public.booking_action(uuid,text,uuid[]), public.create_booking(jsonb), public.save_profile(jsonb), public.authorize_staff(text,text,text), public.set_staff_role(uuid,text) to authenticated;
insert into public.dishes(name,cuisine,vegetarian) values
  ('Paneer butter masala','North Indian',true),('Dal makhani','North Indian',true),('Butter naan','North Indian',true),
  ('Vegetable biryani','South Indian',true),('Masala dosa','South Indian',true),('Chicken chettinad','South Indian',false),
  ('Pasta primavera','Italian',true),('Tiramisu','Italian',true);
commit;
