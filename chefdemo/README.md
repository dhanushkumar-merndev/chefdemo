# ChefFlow

Next.js / TypeScript chef operations prototype, retaining the original cream, yellow and green design in `index.html`.

## Run

```bash
cd chefdemo
pnpm install
pnpm dev
```

Open http://localhost:3000. Supabase is used when the URL and publishable key are present in `.env` or `.env.local`. Environment files are ignored by Git. Never expose a service-role key through a `NEXT_PUBLIC_` variable.

To explore sample data without changing your live configuration:

```bash
pnpm dev:demo --port 3001
```

Demo mode has chef/admin entry buttons. Changes and uploaded photos persist in this browser. It is a UI prototype, not an authentication boundary. A separate build directory keeps live and demo development apart. Browser storage is limited; live photos use Supabase Storage.

## Supabase

The project configured in `.env` was linked and migration `202609080001_chefflow.sql` was pushed using the authenticated CLI. It creates seven tables, secured workflow functions, eight starter dishes and the private `kitchen-photos` bucket.

For another new project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Use `.env.example` for the two public connection settings. Do not apply this migration over a different application's existing tables.

Authorize the first administrator through your Supabase CLI login:

```bash
pnpm admin:grant your-email@example.com
```

Register with that exact email on the login page. If Supabase requires email confirmation, confirm before signing in. Existing accounts receive the role and approval immediately. For a newly registered administrator, run the grant command again after registration to approve the account. `/admin` opens analytics after authentication.

Administrators add staff in **Team & roles**. This authorizes an email and role; it sends no invitation. New staff register with that email and receive the authorized role. All new registrations await administrator approval, including staff whose roles were assigned in advance. Administrators approve or reject members in Team & roles. Pending and rejected accounts cannot access operational data. Other registrations create chef accounts. Role values from signup metadata are ignored.

## SMS login (MSG91)

The login page shows **Email** and **Mobile OTP** when `NEXT_PUBLIC_SMS_LOGIN=on` and the server-only MSG91 and Supabase secret keys in `.env.example` are set. Apply the migrations first (`npx supabase db push`).

Members can register and sign in with either email + password or a mobile + OTP, and add the other later under **Profile → Sign-in methods**; both open the same account:

- An email member verifies their mobile by OTP. A number typed into the profile form is only a contact detail; it signs in only after OTP verification, and a verified number belongs to one account.
- A mobile member adds an email + password. Supabase emails a confirmation link; the email works once confirmed. This needs **Secure email change turned off** (Supabase → Authentication → Providers → Email), because a mobile member's internal address cannot receive the second confirmation.
- Mobile sign-ups get a random internal Auth address (`phone-<uuid>@phone.invalid`, never shown or emailed), because Supabase's phone provider stays off. Like every registration, they await administrator approval as chefs.

Numbers are Indian mobiles only.

Codes are sent and checked from the server through MSG91's widget API, so no MSG91 or captcha script loads in the browser (works with Brave Shields and ad blockers). Keep **captcha off** in the MSG91 widget settings; with it on, MSG91 refuses server calls. The widget token auth is server-only, so the only way to send a code is through `/api/auth/sms/send`, which:

- sends sign-in codes only to verified numbers, and sign-up / verify-mobile codes only to numbers not yet verified (100 per day across those);
- allows per number 1 send per 30 s, 5 per hour, 10 per day; per IP 10 per hour, 30 per day; and 500 SMS per day across all numbers;
- limits code checks to 5 per 15 minutes and 20 per day per number, 30 per hour per IP.

Limits live in `LIMITS` in `src/lib/sms-login.ts` (counters in `sms_rate_counters`). `/api/auth/sms/verify` checks the code with MSG91, re-verifies MSG91's access token with the account authkey, requires MSG91 to attest the same mobile, accepts each token once, and returns a one-time Supabase sign-in token. The member's email password is never changed.

## Location search (Geoapify)

Set the server-only `GEOAPIFY_API_KEY` in `.env` and in your hosting environment. Live mode also uses the server-only `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) to register verified locations. Restart/redeploy after changing environment variables.

In Complete your profile, Profile, or Create booking, choose a region and use **Search localities**. Searches begin after three characters and a typing pause. The existing location dropdown remains available. Selecting a suggestion adds that verified locality to `service_areas` before saving the profile or booking, so no new schema migration is needed for search. The existing expansion migration is still required for the predefined All locations/NCR entries; see [pending.md](pending.md).

`/api/locations` keeps the provider key private, verifies live users are approved, filters suggestions to India and the selected region, and signs results for selection. Signed suggestions expire after 15 minutes; arbitrary names cannot be registered through this endpoint. Existing disabled areas are never reactivated. Search and selection are limited to 30 requests/minute per member per server instance; production scaling may need a shared quota limiter. Demo mode registers selections only in browser storage.

Geoapify/OpenStreetMap attribution appears beside search results. Search is for localities, not live GPS tracking or complete address verification. Geographic coverage depends on the provider's administrative metadata; the full kitchen address is still entered separately.

## Service workflow

1. Admin/manager creates a booking with chef, scheduled in/out timestamps in IST, base fee and hourly overtime rate. Overlapping uncompleted bookings are rejected.
2. Chef accepts or declines.
3. Chef saves the selected dishes, then uploads **Entry photo** and **Kitchen before**.
4. **Check in & start service** records database server time. Only one active service per chef is allowed.
5. Chef uploads **Preparing food** and **Kitchen after**.
6. **Check out & complete** requires all four photos and a saved menu. It records server time and locks the service and photos.

Overtime minutes = `max(0, ceil((actual checkout − scheduled out) / 60 seconds))`.
Additional charge = `round(minutes × hourly rate / 60, 2)`. No grace period. Live estimates update each second; final charges use database timestamps. Full dates support overnight bookings.

Photos accept JPG, PNG or WebP, up to 5 MB. Live files are private and displayed using signed URLs. Photos can be replaced while a service is editable. Old replaced objects are retained; production should add a retention/cleanup job.

## Roles

| Role | Access |
| --- | --- |
| Chef | Assigned bookings, attendance, dishes, kitchen photos, own earnings/profile/tickets |
| Manager | All bookings, creation/cancellation, dish management, photo review, analytics and support |
| Administrator | Manager access plus staff authorization and role assignment |

Includes searchable bookings, a functioning month calendar, earnings CSV exports, dish management, profile updates, support tickets, derived booking alerts and analytics. Database RLS and workflow functions enforce access.

Analytics show completed service value, overtime, available chefs, booking status, seven-day earnings and chef photo completion. Date filters include upcoming bookings. Figures are recorded service values; payment collection, bank payouts and identity verification are outside this prototype.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
npx supabase db lint --linked
```

Unit tests cover overtime boundaries and workflow validation. A PGlite integration test executes the actual migration with mocked Supabase auth/storage schemas and tests RLS, role escalation prevention, photo prerequisites and final charges. Browser tests run an isolated demo server on port 3100, covering chef completion/persistence, admin CRUD/CSV and mobile layouts without mutating the live project.
