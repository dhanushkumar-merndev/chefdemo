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

Analytics show completed service value, overtime, available chefs, booking status, seven-day earnings and chef photo completion. Date filters include upcoming bookings. Figures are recorded service values; payment collection, bank payouts, SMS OTP and identity verification are outside this prototype.

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
