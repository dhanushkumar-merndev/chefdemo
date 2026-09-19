begin;

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'open'
    and public.my_role() <> 'admin'
  );

commit;
