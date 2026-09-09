begin;
alter table public.profiles add column approval_status text not null default 'pending' check(approval_status in ('pending','approved','rejected'));
-- Preserve only existing administrators; every other existing member requires review.
update public.profiles set approval_status = 'approved' where role = 'admin';
create or replace function public.my_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id = auth.uid() and approval_status = 'approved'
$$;
create or replace function public.can_access_booking(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.my_role() is not null and exists(select 1 from public.bookings where id = p_id and (chef_id = auth.uid() or public.my_role() in ('admin','manager')))
$$;
-- Restrictive policies apply in addition to all existing read/write policies.
create policy approved_bookings on public.bookings as restrictive for all to authenticated using(public.my_role() is not null) with check(public.my_role() is not null);
create policy approved_dishes on public.dishes as restrictive for all to authenticated using(public.my_role() is not null) with check(public.my_role() is not null);
create policy approved_tickets on public.tickets as restrictive for all to authenticated using(public.my_role() is not null) with check(public.my_role() is not null);
create function public.review_member(p_id uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if coalesce(public.my_role(),'') <> 'admin' then raise exception 'Administrator access required'; end if;
 if p_id = auth.uid() then raise exception 'You cannot change your own approval'; end if;
 if p_status not in ('approved','rejected') or p_status is null then raise exception 'Choose approved or rejected'; end if;
 perform 1 from public.profiles where id = p_id for update;
 if not found then raise exception 'Member not found'; end if;
 if p_status = 'rejected' and exists(select 1 from public.bookings where chef_id = p_id and status in ('requested','upcoming','in_progress')) then raise exception 'Complete or cancel open bookings before rejecting this member'; end if;
 update public.profiles set approval_status=p_status where id=p_id;
end $$;
revoke execute on function public.review_member(uuid,text) from public,anon;
grant execute on function public.review_member(uuid,text) to authenticated;
create function public.require_approved_chef() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id=new.chef_id and role='chef' and approval_status='approved') then raise exception 'Assign an approved chef'; end if;
 return new;
end $$;
create trigger approved_booking_chef before insert or update of chef_id on public.bookings for each row execute function public.require_approved_chef();
revoke execute on function public.require_approved_chef() from public,anon,authenticated;
commit;
