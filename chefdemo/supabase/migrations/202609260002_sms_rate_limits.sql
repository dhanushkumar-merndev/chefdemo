begin;
-- SMS login sends and verifies codes from the server (MSG91 widget API, no
-- captcha), so the server enforces its own limits: fixed-window counters per
-- key (phone, IP, or a global budget). Each check is one primary-key upsert.
create table public.sms_rate_counters (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key(key, window_start)
);
create index sms_rate_counters_window_start on public.sms_rate_counters(window_start);
alter table public.sms_rate_counters enable row level security;
revoke all on public.sms_rate_counters from anon, authenticated;

-- Counts one hit for p_key in the current p_window_seconds window and returns
-- true while the count is within p_limit. Server (service role) only.
create function public.sms_rate_hit(p_key text, p_limit integer, p_window_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_window_seconds not between 1 and 86400 then raise exception 'Window must be 1 second to 1 day'; end if;
  -- Longest window is a day; older counters are dead weight (indexed delete).
  delete from public.sms_rate_counters where window_start < now() - interval '2 days';
  insert into public.sms_rate_counters(key, window_start, hits) values(p_key, v_start, 1)
    on conflict(key, window_start) do update set hits = public.sms_rate_counters.hits + 1
    returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

revoke execute on function public.sms_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.sms_rate_hit(text, integer, integer) to service_role;
commit;
