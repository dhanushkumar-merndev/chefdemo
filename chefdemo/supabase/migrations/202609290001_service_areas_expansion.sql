-- Expand service areas with Delhi (NCR), Rajasthan, and 'All locations'
begin;

insert into public.service_areas(region, name) values
  ('Bengaluru', 'All locations'),
  ('Chennai', 'All locations'),
  ('Delhi', 'NCR'),
  ('Delhi', 'All locations'),
  ('Hyderabad', 'All locations'),
  ('Mumbai', 'All locations'),
  ('Rajasthan', 'All locations')
on conflict(region, name) do nothing;

commit;
