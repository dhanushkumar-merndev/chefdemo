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

## Code follow-ups before publishing

- [ ] Update chef grouping in `src/components/admin.tsx`: it currently compares only location names. Match the region too, and treat `All locations` as coverage within that region. Otherwise chefs from different regions using the same label can appear in the same nearby group.
- [ ] Refresh existing demo service-area data without deleting saved bookings. `src/lib/repository.ts` currently reuses the saved localStorage dataset, so existing demo sessions will not automatically receive additions from `src/lib/seed.ts`. Live mode reads the database and receives the new rows after the migration and a reload.

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

## Optional later: searchable addresses

No external location API is needed for the fixed service-area dropdowns. If the requirement expands to searching locality names or addresses, consider:

- [Geoapify Address Autocomplete](https://www.geoapify.com/address-autocomplete/): free tier of 3,000 credits/day; one autocomplete request costs one credit. Attribution is required.
- [LocationIQ](https://web.locationiq.com/pricing): free tier of 5,000 requests/day, 2 requests/second and 60 requests/minute; commercial use requires the provider's attribution/link.

Limits checked on 29 September 2026; review current provider terms before integration. These APIs return search suggestions, not a guaranteed complete list of every neighbourhood. Keep the app's supported regions as a separate service-coverage rule. No API integration or new API key is required for this migration.
