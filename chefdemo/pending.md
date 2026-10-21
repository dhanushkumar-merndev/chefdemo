# Pending: apply client service locations

The live database has **not** been changed. The Supabase CLI returned HTTP 403 (the current account does not have permission for the linked project). Sign in with an account that has access to this project before running the migration.

## Client coverage

| Region | Additional location options |
| --- | --- |
| Delhi | NCR, All locations |
| Mumbai | All locations |
| Bengaluru | All locations |
| Hyderabad | All locations |
| Chennai | All locations |
| Rajasthan | All locations |

Existing named areas remain available. “All locations” means coverage across the selected region; this change does not add an exhaustive list of individual neighbourhoods or live GPS tracking.

## Implemented locally

- [x] Geoapify locality search in Complete your profile, Profile, and Create booking. Choose a region, type at least three characters in **Search localities**, and select a result.
- [x] Keep the Geoapify key on the server. Require an approved signed-in account in live mode; accept only server-verified selections when adding a service area. Disabled areas stay disabled.
- [x] Match chefs by region as well as location, including region-wide coverage and Delhi/NCR.
- [x] Add missing service-area defaults to existing demo sessions while preserving saved bookings, custom locations, and disabled entries.
- [x] Restore the original Khana Banao logo and sizing.

Geoapify uses the existing `service_areas` table. Selecting a verified suggestion registers that one locality through the server, then the existing profile/booking save functions can accept it. The migration below is still needed for the predefined **All locations** and **NCR** options. No live profile, booking, or service-area records were changed during implementation/testing.

## Deployment configuration

- [ ] Set `GEOAPIFY_API_KEY` in the hosting environment (it is already configured locally).
- [ ] Keep `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) configured on the server for live-mode location registration, alongside the public Supabase URL and publishable key.
- [ ] Restart the local dev server after changing environment settings; redeploy after setting hosted environment variables.
- [ ] With an approved account, search for a locality, select it, and save/reload a profile or test booking. Existing saved locations remain available when the search service is unavailable.

## Run when ready

From the `chefdemo` directory:

```bash
npx supabase login
npx supabase migration list
npx supabase db push --dry-run
```

This checkout is already linked. If the link is missing or points to the wrong project, run `npx supabase link --project-ref YOUR_PROJECT_REF`, using the project reference from your Supabase dashboard, then repeat the checks above. If HTTP 403 persists, check that your signed-in account has access to that project.

The location migration is `supabase/migrations/202609290001_service_areas_expansion.sql`. Review the dry-run output: `db push` applies all pending migrations, not just the location migration. Once the pending list is correct:

```bash
npx supabase db push
npx supabase migration list
```

The expansion uses `ON CONFLICT (region, name) DO NOTHING`, so it preserves existing rows. Editing the older service-area migration alone does not update an existing database; the new expansion migration must be applied.

## Verify after applying

- [ ] Migration `202609290001` appears in both local and remote history.
- [ ] In Supabase SQL Editor, run:

```sql
select region, name, active
from public.service_areas
order by region, name;
```

- [ ] All six regions above have an active `All locations` entry; Delhi also has active `NCR`.
- [ ] Reload the app. Check **Complete your profile**, **Profile**, and **Create booking** for the new options.
- [ ] Changing the region clears the previous location selection.
- [ ] Save a chef profile and a test booking using the new options.
- [ ] Check that chefs in a different region are listed under **Other areas**, even when both use `All locations`.

## Chef bidding migration (applied 19 October 2026)

`supabase/migrations/202610190001_chef_bidding.sql` was applied to the live database with `supabase db push` on 19 October 2026, together with `202609290001_service_areas_expansion.sql`. It adds:
- orders, bids and chef type
- the bidding, deposit and chef-search functions
- a fix for booking codes

Booking codes currently repeat after booking 9,999, because `lpad(…, 4)` truncates the number. After that, every new booking fails.

Remaining checks on the live app:

- [ ] Every chef is asked for their chef type the next time they open the app.
- [ ] Post a test order with a deadline a few minutes away. Bid as a chef, close bidding, record the deposit, and check that the chef sees the Upcoming booking.
- [ ] Optional: schedule `select public.settle_orders();` every minute with pg_cron.

## Full locality list and admin editing (not yet applied)

Two new migrations:

- `202610210001_service_area_localities.sql` adds 3,952 localities (Bengaluru 726, Chennai 504, Hyderabad 572, Mumbai 594, Delhi 838, Rajasthan 718). Existing rows are left alone.
- `202610210002_admin_editing.sql` adds `service_area_list()`, `admin_update_chef`, `update_order`, `rename_service_area` and an index on orders by place.

Apply the migrations **before** deploying the new app. The new app loads locations through `service_area_list()` and shows an error until that function exists. The migrations only add rows and functions, so the app that is live now keeps working after they are applied.

```bash
npx supabase db push --dry-run   # should list only the two migrations above
npx supabase db push
```

Then check on the live app:

- [ ] As a chef, Profile → Location you work in shows "Showing 50 of …" for the region, and typing narrows it.
- [ ] As an admin, edit a chef from Find chefs, and check that the change shows.
- [ ] Post a test order, edit it, bid on it as a chef, then check that guests and timings are locked in Edit order.
- [ ] Administration → Service locations: add, rename and turn off a test location.

## Location search notes

[Geoapify Address Autocomplete](https://www.geoapify.com/address-autocomplete/) is integrated. The free tier provides 3,000 credits/day, with one credit per autocomplete request (checked 29 September 2026). The UI includes Geoapify/OpenStreetMap attribution, waits for a typing pause, and cancels outdated searches. The server applies a per-member, per-instance limit of 30 requests/minute; this is not a distributed daily spending cap.

Results are restricted to India and checked against the selected region using the provider's city/state/district metadata. Delhi includes recognised NCR areas, and Rajasthan spans the state. Source for NCR district names: [NCR Planning Board](https://ncrpb.nic.in/ncrconstituent.html). Provider data can be incomplete; the search does not guarantee every neighbourhood or exact service boundaries. Kitchen address entry remains separate from service locality selection.
