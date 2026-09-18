begin;
-- Service areas: a fixed region -> location list that chefs and bookings choose from.
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  region text not null check(length(trim(region)) between 1 and 80),
  name text not null check(length(trim(name)) between 1 and 80),
  active boolean not null default true,
  unique(region, name)
);
alter table public.profiles add column region text not null default '';
alter table public.profiles add column location text not null default '';
alter table public.bookings add column region text not null default '';
alter table public.bookings add column location text not null default '';

-- Short, human-readable booking code (CF-1001) for phone and search use.
create sequence public.booking_code_seq start 1001;
alter table public.bookings add column code text not null unique
  default 'CF-' || lpad(nextval('public.booking_code_seq')::text, 4, '0');
create index bookings_location on public.bookings(region, location);
create index bookings_schedule on public.bookings(scheduled_start);

alter table public.service_areas enable row level security;
revoke all on public.service_areas from anon, authenticated;
grant select on public.service_areas to authenticated;
create policy areas_read on public.service_areas for select to authenticated using(public.my_role() is not null);

create function public.save_service_area(p_region text, p_name text, p_active boolean default true) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
  if coalesce(trim(p_region),'') = '' or coalesce(trim(p_name),'') = '' then raise exception 'Region and location are required'; end if;
  insert into public.service_areas(region,name,active) values(trim(p_region),trim(p_name),coalesce(p_active,true))
    on conflict(region,name) do update set active = excluded.active;
end $$;
revoke execute on function public.save_service_area(text,text,boolean) from public, anon;
grant execute on function public.save_service_area(text,text,boolean) to authenticated;

-- A chef must record the area they serve; managers and admins may leave it blank.
create or replace function public.save_profile(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_role text; v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'chef' and (v_region = '' or v_location = '') then raise exception 'Select the region and location you work in'; end if;
  if (v_region <> '' or v_location <> '') and not exists(
    select 1 from public.service_areas where region = v_region and name = v_location and active
  ) then raise exception 'Choose a location from the list'; end if;
  update public.profiles set name = trim(p_input->>'name'), phone = left(p_input->>'phone',30), cuisine = left(p_input->>'cuisine',120),
    experience = (p_input->>'experience')::integer, online = (p_input->>'online')::boolean,
    region = left(v_region,80), location = left(v_location,80) where id = auth.uid();
end $$;

-- Bookings carry the service location; the assigned chef must be approved.
create or replace function public.create_booking(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_chef uuid := (p_input->>'chef_id')::uuid; v_dishes uuid[];
  v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  if v_region = '' or v_location = '' then raise exception 'Select the region and location of this service'; end if;
  if not exists(select 1 from public.service_areas where region = v_region and name = v_location and active) then
    raise exception 'Choose a location from the list'; end if;
  perform 1 from public.profiles where id = v_chef and role = 'chef' for update;
  if not found then raise exception 'Select a chef'; end if;
  if exists(select 1 from public.bookings where chef_id = v_chef and status not in ('completed','cancelled') and scheduled_start < (p_input->>'scheduled_end')::timestamptz and scheduled_end > (p_input->>'scheduled_start')::timestamptz) then raise exception 'This chef already has a booking during these timings'; end if;
  v_dishes := array(select jsonb_array_elements_text(coalesce(p_input->'dish_ids','[]'))::uuid);
  if exists(select 1 from unnest(v_dishes) x where not exists(select 1 from public.dishes where id = x and active)) then raise exception 'Select active dishes'; end if;
  insert into public.bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,base_amount,overtime_rate,dish_ids,notes,region,location)
  values(v_chef,trim(p_input->>'customer'),trim(p_input->>'service'),trim(p_input->>'address'),(p_input->>'guests')::integer,
    (p_input->>'scheduled_start')::timestamptz,(p_input->>'scheduled_end')::timestamptz,(p_input->>'base_amount')::numeric,
    (p_input->>'overtime_rate')::numeric,v_dishes,coalesce(p_input->>'notes',''),left(v_region,80),left(v_location,80));
end $$;

insert into public.service_areas(region,name) values
  ('Bengaluru','Koramangala'),('Bengaluru','Indiranagar'),('Bengaluru','Whitefield'),('Bengaluru','HSR Layout'),('Bengaluru','Jayanagar'),
  ('Chennai','Adyar'),('Chennai','Anna Nagar'),('Chennai','T Nagar'),
  ('Hyderabad','Gachibowli'),('Hyderabad','Banjara Hills'),
  ('Mumbai','Andheri'),('Mumbai','Bandra'),('Mumbai','Powai')
on conflict(region,name) do nothing;
commit;
