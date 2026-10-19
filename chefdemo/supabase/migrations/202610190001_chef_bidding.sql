begin;
-- Chef marketplace. Staff post an order with a bidding deadline; approved
-- chefs who serve the area and are free at that time bid a price (sealed: a
-- chef sees only their own bid). At the deadline the cheapest bid wins (ties:
-- the earliest bid). Staff then record the client's 20% deposit (simulated),
-- which confirms the order and assigns the winning chef as an upcoming booking.

-- Chef specialisation, used by chef search.
alter table public.profiles add column chef_type text not null default ''
  check(chef_type in ('','home_cook','professional_chef','caterer','baker','tandoor_specialist'));
create index profiles_chef_search on public.profiles(region, experience) where role = 'chef' and approval_status = 'approved';

-- Matches servesArea in src/lib/service-areas.ts.
create function public.serves_area(p_chef_region text, p_chef_location text, p_region text, p_location text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_region,'') <> '' and coalesce(p_location,'') <> '' and coalesce(p_chef_location,'') <> ''
    and p_chef_region = p_region and (
      p_chef_location = p_location or p_chef_location = 'All locations' or p_location = 'All locations'
      or (p_region = 'Delhi' and (p_chef_location = 'NCR' or p_location = 'NCR')))
$$;

-- lpad(…, 4) truncates: booking 10,000 got 'CF-1000' again and every later
-- insert hit the unique code. The sequence starts at 1001, so plain digits
-- keep the existing 4-digit codes and grow past 9999.
alter table public.bookings alter column code set default 'CF-' || nextval('public.booking_code_seq')::text;

create sequence public.order_code_seq start 1001;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default 'OR-' || nextval('public.order_code_seq')::text,
  customer text not null check(length(trim(customer)) between 1 and 120),
  service text not null check(length(trim(service)) between 1 and 160),
  address text not null check(length(trim(address)) between 1 and 500),
  region text not null check(length(trim(region)) between 1 and 80),
  location text not null check(length(trim(location)) between 1 and 80),
  guests integer not null check(guests between 1 and 500),
  scheduled_start timestamptz not null, scheduled_end timestamptz not null,
  bid_deadline timestamptz not null,
  overtime_rate numeric(12,2) not null check(overtime_rate between 0 and 1000000),
  max_budget numeric(12,2) check(max_budget is null or max_budget between 1 and 1000000),
  dish_ids uuid[] not null default '{}', notes text not null default '',
  status text not null default 'open' check(status in ('open','awarded','confirmed','unfilled','cancelled')),
  winning_bid_id uuid,
  deposit_amount numeric(12,2) not null default 0 check(deposit_amount >= 0),
  deposit_ref text, deposit_paid_at timestamptz,
  booking_id uuid unique references public.bookings,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  check(scheduled_end > scheduled_start), check(bid_deadline <= scheduled_start)
);
create index orders_due on public.orders(bid_deadline) where status = 'open';
create index orders_region_open on public.orders(region, bid_deadline) where status = 'open';
create index orders_status_created on public.orders(status, created_at desc);
create index orders_created on public.orders(created_at desc);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  chef_id uuid not null references public.profiles,
  amount numeric(12,2) not null check(amount between 1 and 1000000),
  message text not null default '' check(length(message) <= 500),
  status text not null default 'active' check(status in ('active','withdrawn','won','lost')),
  created_at timestamptz not null default clock_timestamp(),
  -- When the current amount was offered; ties go to the earliest offer.
  updated_at timestamptz not null default clock_timestamp(),
  unique(order_id, chef_id)
);
create index bids_ranking on public.bids(order_id, amount, updated_at) where status = 'active';
create index bids_chef on public.bids(chef_id, order_id);
create index bids_won on public.bids(chef_id) where status = 'won';
alter table public.orders add constraint orders_winning_bid foreign key (winning_bid_id) references public.bids;

alter table public.bookings add column order_id uuid unique references public.orders;
alter table public.bookings add column deposit_amount numeric(12,2) not null default 0 check(deposit_amount >= 0);
-- Open bookings per chef are few; overlap checks probe only these.
create index bookings_chef_open on public.bookings(chef_id, scheduled_start) where status not in ('completed','cancelled');

-- A chef is busy with an unfinished booking, or with an order awarded to them
-- that awaits its deposit (a hold, so award and deposit cannot be double-booked).
create function public.chef_busy(p_chef uuid, p_start timestamptz, p_end timestamptz, p_except_order uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.bookings where chef_id = p_chef and status not in ('completed','cancelled')
      and scheduled_start < p_end and scheduled_end > p_start)
    or exists(select 1 from public.bids b join public.orders o on o.id = b.order_id
      where b.chef_id = p_chef and b.status = 'won' and o.status = 'awarded' and o.id is distinct from p_except_order
      and o.scheduled_start < p_end and o.scheduled_end > p_start)
$$;

-- Manual bookings respect bid holds too.
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
  if public.chef_busy(v_chef, (p_input->>'scheduled_start')::timestamptz, (p_input->>'scheduled_end')::timestamptz) then
    raise exception 'This chef already has a booking during these timings'; end if;
  v_dishes := array(select jsonb_array_elements_text(coalesce(p_input->'dish_ids','[]'))::uuid);
  if exists(select 1 from unnest(v_dishes) x where not exists(select 1 from public.dishes where id = x and active)) then raise exception 'Select active dishes'; end if;
  insert into public.bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,base_amount,overtime_rate,dish_ids,notes,region,location)
  values(v_chef,trim(p_input->>'customer'),trim(p_input->>'service'),trim(p_input->>'address'),(p_input->>'guests')::integer,
    (p_input->>'scheduled_start')::timestamptz,(p_input->>'scheduled_end')::timestamptz,(p_input->>'base_amount')::numeric,
    (p_input->>'overtime_rate')::numeric,v_dishes,coalesce(p_input->>'notes',''),left(v_region,80),left(v_location,80));
end $$;

-- As in 202609260003_phone_signup.sql, plus chef_type (required for chefs; kept
-- when the caller does not send it).
create or replace function public.save_profile(p_input jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_phone text := coalesce(trim(p_input->>'phone'),''); v_key text := public.mobile_key(p_input->>'phone'); v_same boolean; v_type text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into me from public.profiles where id = auth.uid();
  v_type := coalesce(trim(p_input->>'chef_type'), me.chef_type);
  if me.role = 'chef' and (v_region = '' or v_location = '') then raise exception 'Select the region and location you work in'; end if;
  if me.role = 'chef' and v_type = '' then raise exception 'Select your chef type'; end if;
  if v_type not in ('','home_cook','professional_chef','caterer','baker','tandoor_specialist') then raise exception 'Choose a chef type from the list'; end if;
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
    region = left(v_region,80), location = left(v_location,80),
    chef_type = case when me.role = 'chef' then v_type else chef_type end where id = auth.uid();
end $$;

create function public.create_order(p_input jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_dishes uuid[]; v_start timestamptz := (p_input->>'scheduled_start')::timestamptz;
  v_end timestamptz := (p_input->>'scheduled_end')::timestamptz; v_deadline timestamptz := (p_input->>'bid_deadline')::timestamptz;
  v_region text := coalesce(trim(p_input->>'region'),''); v_location text := coalesce(trim(p_input->>'location'),'');
  v_budget numeric := nullif(p_input->>'max_budget','')::numeric;
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  if coalesce(trim(p_input->>'customer'),'') = '' or coalesce(trim(p_input->>'service'),'') = '' or coalesce(trim(p_input->>'address'),'') = '' then
    raise exception 'Customer, service and address are required'; end if;
  if v_region = '' or v_location = '' then raise exception 'Select the region and location of this service'; end if;
  if not exists(select 1 from public.service_areas where region = v_region and name = v_location and active) then
    raise exception 'Choose a location from the list'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'Scheduled out time must be after in time'; end if;
  if v_deadline is null or v_deadline <= clock_timestamp() or v_deadline > v_start then
    raise exception 'The bidding deadline must be in the future and before the service starts'; end if;
  if v_budget is not null and v_budget not between 1 and 1000000 then raise exception 'Enter a budget between ₹1 and ₹10,00,000'; end if;
  v_dishes := array(select jsonb_array_elements_text(coalesce(p_input->'dish_ids','[]'))::uuid);
  if exists(select 1 from unnest(v_dishes) x where not exists(select 1 from public.dishes where id = x and active)) then raise exception 'Select active dishes'; end if;
  insert into public.orders(customer,service,address,region,location,guests,scheduled_start,scheduled_end,bid_deadline,overtime_rate,max_budget,dish_ids,notes)
  values(trim(p_input->>'customer'),trim(p_input->>'service'),trim(p_input->>'address'),left(v_region,80),left(v_location,80),
    (p_input->>'guests')::integer,v_start,v_end,v_deadline,(p_input->>'overtime_rate')::numeric,v_budget,v_dishes,
    left(coalesce(p_input->>'notes',''),2000))
  returning id into v_id;
  return v_id;
end $$;

create function public.place_bid(p_order uuid, p_amount numeric, p_message text default '') returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; me public.profiles;
begin
  if coalesce(public.my_role(),'') <> 'chef' then raise exception 'Only approved chefs can bid'; end if;
  select * into me from public.profiles where id = auth.uid();
  -- Shares the row with other bidders; settle_orders skips it until we commit.
  select * into o from public.orders where id = p_order for share;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'open' or o.bid_deadline <= clock_timestamp() then raise exception 'Bidding has closed for this order'; end if;
  if not public.serves_area(me.region, me.location, o.region, o.location) then raise exception 'This order is outside the area you serve'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception 'Enter a bid between ₹1 and ₹10,00,000'; end if;
  if o.max_budget is not null and p_amount > o.max_budget then raise exception 'Your bid is above this order''s budget'; end if;
  if public.chef_busy(me.id, o.scheduled_start, o.scheduled_end) then raise exception 'You already have a booking during these timings'; end if;
  insert into public.bids as b(order_id, chef_id, amount, message) values(p_order, me.id, p_amount, left(coalesce(trim(p_message),''),500))
  on conflict(order_id, chef_id) do update set amount = excluded.amount, message = excluded.message, status = 'active',
    updated_at = case when b.amount <> excluded.amount or b.status <> 'active' then clock_timestamp() else b.updated_at end;
end $$;

create function public.withdraw_bid(p_order uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') <> 'chef' then raise exception 'Only approved chefs can bid'; end if;
  perform 1 from public.orders where id = p_order and status = 'open' and bid_deadline > clock_timestamp() for share;
  if not found then raise exception 'Bidding has closed for this order'; end if;
  update public.bids set status = 'withdrawn' where order_id = p_order and chef_id = auth.uid() and status = 'active';
  if not found then raise exception 'You have no active bid on this order'; end if;
end $$;

-- Awards every open order whose deadline has passed (or just p_order). Each
-- round gives every order its cheapest eligible bid, one award per chef per
-- round (earliest deadline first), so a chef never wins two overlapping
-- orders; a deferred order is retried next round against the new holds.
-- Rounds are bounded by the most orders one chef is cheapest on, not by the
-- number of orders. Orders left without an eligible bid become unfilled.
-- Deterministic, so any signed-in member may trigger it (list_orders does).
create function public.settle_orders(p_order uuid default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_awarded integer;
begin
  select array_agg(id) into v_ids from (
    select id from public.orders
    where status = 'open' and bid_deadline <= clock_timestamp() and (p_order is null or id = p_order)
    for update skip locked
  ) due;
  if v_ids is null then return; end if;
  loop
    with candidates as (
      select distinct on (b.order_id) b.order_id, b.id bid_id, b.chef_id, o.bid_deadline
      from public.orders o
      join public.bids b on b.order_id = o.id and b.status = 'active'
      join public.profiles p on p.id = b.chef_id and p.role = 'chef' and p.approval_status = 'approved'
      where o.id = any(v_ids) and o.status = 'open'
        and not public.chef_busy(b.chef_id, o.scheduled_start, o.scheduled_end)
      order by b.order_id, b.amount, b.updated_at, b.id
    ), picks as (
      select order_id, bid_id from (
        select *, row_number() over (partition by chef_id order by bid_deadline, order_id) rn from candidates
      ) c where rn = 1
    ), awarded as (
      update public.orders o set status = 'awarded', winning_bid_id = p.bid_id
      from picks p where o.id = p.order_id
      returning o.id, p.bid_id
    )
    update public.bids b set status = case when b.id = a.bid_id then 'won' else 'lost' end
    from awarded a where b.order_id = a.id and b.status = 'active';
    get diagnostics v_awarded = row_count;
    exit when v_awarded = 0;
  end loop;
  update public.orders set status = 'unfilled' where id = any(v_ids) and status = 'open';
end $$;

create function public.close_bidding(p_order uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  update public.orders set bid_deadline = least(bid_deadline, clock_timestamp()) where id = p_order and status = 'open';
  if not found then raise exception 'Only an open order can be closed'; end if;
  perform public.settle_orders(p_order);
end $$;

-- Simulated payment: records the 20% deposit, then assigns the winning chef.
create function public.record_deposit(p_order uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orders; w public.bids; v_booking uuid; v_deposit numeric;
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'confirmed' then raise exception 'The deposit for this order has already been recorded'; end if;
  if o.status <> 'awarded' then raise exception 'Close bidding and award the order before recording the deposit'; end if;
  select * into w from public.bids where id = o.winning_bid_id;
  if public.chef_busy(w.chef_id, o.scheduled_start, o.scheduled_end, o.id) then
    raise exception 'The winning chef is no longer available for these timings'; end if;
  v_deposit := round(w.amount * 0.20, 2);
  insert into public.bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,base_amount,overtime_rate,
    dish_ids,notes,region,location,status,order_id,deposit_amount)
  values(w.chef_id,o.customer,o.service,o.address,o.guests,o.scheduled_start,o.scheduled_end,w.amount,o.overtime_rate,
    o.dish_ids,o.notes,o.region,o.location,'upcoming',o.id,v_deposit)
  returning id into v_booking;
  update public.orders set status = 'confirmed', deposit_amount = v_deposit, deposit_ref = 'SIM-' || o.code,
    deposit_paid_at = clock_timestamp(), booking_id = v_booking where id = p_order;
  return v_booking;
end $$;

create function public.cancel_order(p_order uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  update public.orders set status = 'cancelled' where id = p_order and status in ('open','awarded','unfilled');
  if not found then raise exception 'Only an open, awarded or unfilled order can be cancelled'; end if;
end $$;

-- One page of orders plus the exact total. Staff see every order with its bid
-- count and lowest bid. Chefs see open orders they could serve and orders they
-- bid on, with their own bid only; the address appears once they win.
create function public.list_orders(p_status text default 'all', p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text := public.my_role(); me public.profiles; v_rows jsonb; v_total bigint;
begin
  if v_role is null then raise exception 'Sign in required'; end if;
  p_status := coalesce(p_status,'all');
  p_limit := least(greatest(coalesce(p_limit,20),1),100);
  p_offset := greatest(coalesce(p_offset,0),0);
  perform public.settle_orders();
  if v_role in ('admin','manager') then
    select count(*) into v_total from public.orders where p_status = 'all' or status = p_status;
    select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id), '[]') into v_rows from (
      select o.*, s.bid_count, s.lowest_bid, wp.name winner_name, wb.chef_id winner_id, wb.amount winning_amount
      from public.orders o
      left join lateral (
        select count(*) filter (where status <> 'withdrawn') bid_count, min(amount) filter (where status <> 'withdrawn') lowest_bid
        from public.bids where order_id = o.id
      ) s on true
      left join public.bids wb on wb.id = o.winning_bid_id
      left join public.profiles wp on wp.id = wb.chef_id
      where p_status = 'all' or o.status = p_status
      order by o.created_at desc, o.id limit p_limit offset p_offset
    ) page;
  else
    select * into me from public.profiles where id = auth.uid();
    with visible as (
      select o.id from public.orders o
      where o.status = 'open' and o.region = me.region and public.serves_area(me.region, me.location, o.region, o.location)
      union
      select order_id from public.bids where chef_id = me.id
    )
    select count(*) into v_total from public.orders o join visible v on v.id = o.id where p_status = 'all' or o.status = p_status;
    with visible as (
      select o.id from public.orders o
      where o.status = 'open' and o.region = me.region and public.serves_area(me.region, me.location, o.region, o.location)
      union
      select order_id from public.bids where chef_id = me.id
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id), '[]') into v_rows from (
      select o.id, o.code, o.customer, o.service, o.region, o.location, o.guests, o.scheduled_start, o.scheduled_end,
        o.bid_deadline, o.overtime_rate, o.max_budget, o.dish_ids, o.notes, o.status, o.created_at,
        case when mb.status = 'won' then o.address end address,
        case when mb.status = 'won' then o.booking_id end booking_id,
        case when mb.status = 'won' then o.deposit_amount else 0 end deposit_amount,
        case when mb.id is not null then jsonb_build_object('amount', mb.amount, 'message', mb.message, 'status', mb.status, 'updated_at', mb.updated_at) end my_bid
      from public.orders o
      join visible v on v.id = o.id
      left join public.bids mb on mb.order_id = o.id and mb.chef_id = me.id
      where p_status = 'all' or o.status = p_status
      order by o.created_at desc, o.id limit p_limit offset p_offset
    ) page;
  end if;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

create function public.order_bids(p_order uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.status = 'withdrawn', x.amount, x.updated_at, x.id), '[]') from (
    select b.*, p.name chef_name, p.chef_type, p.experience, p.region chef_region, p.location chef_location
    from public.bids b join public.profiles p on p.id = b.chef_id where b.order_id = p_order
  ) x);
end $$;

-- Approved chefs matching a filter: region/location (serves_area), chef type,
-- minimum experience, online, and free between start and end. The busy check
-- probes each candidate's open bookings by index, so a wide window costs the
-- same as a narrow one.
create function public.chef_matches(p_filter jsonb) returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
  where p.role = 'chef' and p.approval_status = 'approved'
    and (coalesce(p_filter->>'region','') = '' or p.region = p_filter->>'region')
    and (coalesce(p_filter->>'location','') = '' or public.serves_area(p.region, p.location, p_filter->>'region', p_filter->>'location'))
    and (coalesce(p_filter->>'chef_type','') = '' or p.chef_type = p_filter->>'chef_type')
    and p.experience >= coalesce((p_filter->>'min_experience')::integer, 0)
    and (not coalesce((p_filter->>'online_only')::boolean, false) or p.online)
    and (coalesce(p_filter->>'start','') = '' or coalesce(p_filter->>'end','') = ''
      or not public.chef_busy(p.id, (p_filter->>'start')::timestamptz, (p_filter->>'end')::timestamptz))
$$;

create function public.search_chefs(p_filter jsonb, p_limit integer default 20, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb; v_total bigint;
begin
  if coalesce(public.my_role(),'') not in ('admin','manager') then raise exception 'Manager access required'; end if;
  if coalesce(p_filter->>'start','') <> '' and coalesce(p_filter->>'end','') <> ''
    and (p_filter->>'end')::timestamptz <= (p_filter->>'start')::timestamptz then
    raise exception 'The availability end must be after its start'; end if;
  p_limit := least(greatest(coalesce(p_limit,20),1),100);
  p_offset := greatest(coalesce(p_offset,0),0);
  select count(*) into v_total from public.chef_matches(p_filter);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
      'chef_type', m.chef_type, 'experience', m.experience, 'cuisine', m.cuisine, 'region', m.region,
      'location', m.location, 'online', m.online) order by m.experience desc, m.name, m.id), '[]')
  into v_rows from (
    select * from public.chef_matches(p_filter) order by experience desc, name, id limit p_limit offset p_offset
  ) m;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

alter table public.orders enable row level security;
alter table public.bids enable row level security;
revoke all on public.orders, public.bids from anon, authenticated;
grant select on public.orders, public.bids to authenticated;
-- Chefs read orders only through list_orders, which hides addresses until they win.
create policy orders_staff_read on public.orders for select to authenticated
  using((select public.my_role()) in ('admin','manager'));
create policy bids_read on public.bids for select to authenticated
  using((select public.my_role()) in ('admin','manager') or (chef_id = (select auth.uid()) and (select public.my_role()) = 'chef'));

revoke execute on function public.serves_area(text,text,text,text), public.chef_busy(uuid,timestamptz,timestamptz,uuid),
  public.chef_matches(jsonb) from public, anon, authenticated;
revoke execute on function public.create_order(jsonb), public.place_bid(uuid,numeric,text), public.withdraw_bid(uuid),
  public.settle_orders(uuid), public.close_bidding(uuid), public.record_deposit(uuid), public.cancel_order(uuid),
  public.list_orders(text,integer,integer), public.order_bids(uuid), public.search_chefs(jsonb,integer,integer) from public, anon;
grant execute on function public.create_order(jsonb), public.place_bid(uuid,numeric,text), public.withdraw_bid(uuid),
  public.settle_orders(uuid), public.close_bidding(uuid), public.record_deposit(uuid), public.cancel_order(uuid),
  public.list_orders(text,integer,integer), public.order_bids(uuid), public.search_chefs(jsonb,integer,integer) to authenticated;
grant execute on function public.settle_orders(uuid) to service_role;
commit;
