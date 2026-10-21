begin;
-- Admin editing: chef details, open orders and the service-location list.
-- Also serves the full location list in one call (PostgREST caps plain table
-- reads at 1,000 rows, and service_areas now holds every locality).

create index orders_area on public.orders(region, location);

-- Every service area as one compact JSON array, for approved members.
create function public.service_area_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.my_role() is null then '[]'::jsonb else coalesce(
    (select jsonb_agg(jsonb_build_object('id', id, 'region', region, 'name', name, 'active', active) order by region, name)
     from public.service_areas), '[]') end
$$;

-- An administrator edits a chef's work details. Phone and email are sign-in
-- methods and stay with the member (save_profile / Sign-in methods).
create function public.admin_update_chef(p_id uuid, p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare c public.profiles; v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_type text := coalesce(trim(p_input->>'chef_type'),''); v_name text := coalesce(trim(p_input->>'name'),'');
  v_exp integer := (p_input->>'experience')::integer;
begin
  if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
  select * into c from public.profiles where id = p_id and role = 'chef' for update;
  if not found then raise exception 'Chef not found'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'Enter the chef''s name'; end if;
  if v_region = '' or v_location = '' then raise exception 'Select the region and location this chef works in'; end if;
  if (v_region, v_location) is distinct from (c.region, c.location) and not exists(
    select 1 from public.service_areas where region = v_region and name = v_location and active
  ) then raise exception 'Choose a location from the list'; end if;
  if v_type not in ('home_cook','professional_chef','caterer','baker','tandoor_specialist') then raise exception 'Select a chef type from the list'; end if;
  if v_exp is null or v_exp not between 0 and 80 then raise exception 'Experience must be between 0 and 80 years'; end if;
  update public.profiles set name = v_name, region = left(v_region,80), location = left(v_location,80), chef_type = v_type,
    experience = v_exp, cuisine = left(coalesce(p_input->>'cuisine',''),120),
    online = coalesce((p_input->>'online')::boolean, online)
  where id = p_id;
end $$;

-- Staff edit an order while it is open for bids. Once a chef has an active
-- bid, the terms they priced (place, timings, guests, budget, overtime rate)
-- are locked; customer, address, notes, dishes and the deadline stay editable.
create function public.update_order(p_order uuid, p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_dishes uuid[];
  v_start timestamptz := (p_input->>'scheduled_start')::timestamptz; v_end timestamptz := (p_input->>'scheduled_end')::timestamptz;
  v_deadline timestamptz := (p_input->>'bid_deadline')::timestamptz;
  v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_budget numeric := nullif(p_input->>'max_budget','')::numeric; v_guests integer := (p_input->>'guests')::integer;
  v_rate numeric := (p_input->>'overtime_rate')::numeric;
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'open' then raise exception 'Only an order that is open for bids can be edited'; end if;
  if coalesce(trim(p_input->>'customer'),'') = '' or coalesce(trim(p_input->>'service'),'') = '' or coalesce(trim(p_input->>'address'),'') = '' then
    raise exception 'Customer, service and address are required'; end if;
  if v_region = '' or v_location = '' then raise exception 'Select the region and location of this service'; end if;
  if (v_region, v_location) is distinct from (o.region, o.location) and not exists(
    select 1 from public.service_areas where region = v_region and name = v_location and active
  ) then raise exception 'Choose a location from the list'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'Scheduled out time must be after in time'; end if;
  if v_deadline is null or v_deadline <= clock_timestamp() or v_deadline > v_start then
    raise exception 'The bidding deadline must be in the future and before the service starts'; end if;
  if v_guests is null or v_guests not between 1 and 500 then raise exception 'Guest count must be between 1 and 500'; end if;
  if v_rate is null or v_rate not between 0 and 1000000 then raise exception 'Enter a valid non-negative overtime rate'; end if;
  if v_budget is not null and v_budget not between 1 and 1000000 then raise exception 'Enter a budget between ₹1 and ₹10,00,000'; end if;
  v_dishes := array(select jsonb_array_elements_text(coalesce(p_input->'dish_ids','[]'))::uuid);
  if exists(select 1 from unnest(v_dishes) x where not exists(select 1 from public.dishes where id = x and active)) then raise exception 'Select active dishes'; end if;
  if exists(select 1 from public.bids where order_id = p_order and status = 'active') and (
    (v_region, v_location) is distinct from (o.region, o.location) or v_start <> o.scheduled_start or v_end <> o.scheduled_end
    or v_guests <> o.guests or v_budget is distinct from o.max_budget or v_rate <> o.overtime_rate
  ) then raise exception 'Chefs have already bid on this order. Cancel it and post a new one to change place, timings, guests, budget or rate'; end if;
  update public.orders set customer = trim(p_input->>'customer'), service = trim(p_input->>'service'), address = trim(p_input->>'address'),
    region = left(v_region,80), location = left(v_location,80), guests = v_guests, scheduled_start = v_start, scheduled_end = v_end,
    bid_deadline = v_deadline, overtime_rate = v_rate, max_budget = v_budget, dish_ids = v_dishes,
    notes = left(coalesce(p_input->>'notes',''),2000)
  where id = p_order;
end $$;

-- Renames a location and carries the new name to the chefs, open orders and
-- unfinished bookings that use it (one set-based update each). Completed and
-- cancelled history keeps the name it was recorded with.
create function public.rename_service_area(p_id uuid, p_name text) returns void language plpgsql security definer set search_path = '' as $$
declare a public.service_areas; v_name text := coalesce(trim(p_name),'');
begin
  if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'Enter a location name (up to 80 characters)'; end if;
  select * into a from public.service_areas where id = p_id for update;
  if not found then raise exception 'Location not found'; end if;
  -- Area matching (serves_area) depends on these two names.
  if a.name = 'All locations' or (a.region = 'Delhi' and a.name = 'NCR') then raise exception 'This built-in location cannot be renamed'; end if;
  if v_name = a.name then return; end if;
  if exists(select 1 from public.service_areas where region = a.region and lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'A location with this name already exists in %', a.region; end if;
  update public.service_areas set name = v_name where id = p_id;
  update public.profiles set location = v_name where region = a.region and location = a.name;
  update public.orders set location = v_name where region = a.region and location = a.name and status in ('open','awarded','unfilled');
  update public.bookings set location = v_name where region = a.region and location = a.name and status in ('requested','upcoming','in_progress');
end $$;

revoke execute on function public.service_area_list(), public.admin_update_chef(uuid,jsonb), public.update_order(uuid,jsonb),
  public.rename_service_area(uuid,text) from public, anon;
grant execute on function public.service_area_list(), public.admin_update_chef(uuid,jsonb), public.update_order(uuid,jsonb),
  public.rename_service_area(uuid,text) to authenticated;
commit;
