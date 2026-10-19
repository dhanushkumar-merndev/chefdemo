import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);

/** A database with every migration applied, in order, on mocked Supabase
 *  auth/storage schemas (as in database.test.ts). */
async function migrated() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text default auth.uid()::text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  return db;
}

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

test("bidding: sealed bids, cheapest wins, 20% deposit assigns the chef, staff-only controls", async () => {
  const db = await migrated();
  try {
    const [admin, chefA, chefB, chefC, chefD, pending] = [1, 2, 3, 4, 5, 6].map(id);
    await db.query(
      `insert into auth.users(id,email) values ($1,'admin@t.dev'),($2,'a@t.dev'),($3,'b@t.dev'),($4,'c@t.dev'),($5,'d@t.dev'),($6,'p@t.dev')`,
      [admin, chefA, chefB, chefC, chefD, pending],
    );
    await db.query(`update profiles set role='admin', approval_status='approved' where id=$1`, [admin]);
    const setChef = (who: string, region: string, location: string, type: string, exp: number, status = "approved") =>
      db.query(
        `update profiles set approval_status=$2, region=$3, location=$4, chef_type=$5, experience=$6 where id=$1`,
        [who, status, region, location, type, exp],
      );
    await setChef(chefA, "Bengaluru", "Koramangala", "professional_chef", 8);
    await setChef(chefB, "Bengaluru", "All locations", "home_cook", 3);
    await setChef(chefC, "Mumbai", "Bandra", "caterer", 10);
    await setChef(chefD, "Bengaluru", "Koramangala", "baker", 5);
    await setChef(pending, "Bengaluru", "Koramangala", "baker", 5, "pending");

    const as = async (who: string) => {
      await db.exec("reset role");
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
    };
    const asSuper = () => db.exec("reset role");
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const newOrder = async (extra: Record<string, unknown> = {}) =>
      (
        await one<{ id: string }>("select create_order($1::jsonb) id", [
          JSON.stringify({
            customer: "Kavya", service: "Dinner", address: "12 Secret Lane", region: "Bengaluru", location: "Koramangala",
            guests: 6, scheduled_start: iso(48), scheduled_end: iso(51), bid_deadline: iso(1), overtime_rate: 300,
            max_budget: 4000, dish_ids: [], notes: "", ...extra,
          }),
        ])
      ).id;
    const list = async (status = "all") =>
      (await one<{ r: { rows: Record<string, unknown>[]; total: number } }>("select list_orders($1) r", [status])).r;
    const bid = (order: string, amount: number, message = "") => db.query("select place_bid($1,$2,$3)", [order, amount, message]);

    // Posting orders is staff-only and validated.
    await as(chefA);
    await assert.rejects(newOrder(), /Manager access/);
    await as(admin);
    await assert.rejects(newOrder({ bid_deadline: iso(-1) }), /deadline must be in the future/);
    await assert.rejects(newOrder({ bid_deadline: iso(49) }), /before the service starts/);
    await assert.rejects(newOrder({ location: "Atlantis" }), /from the list/);
    const order1 = await newOrder();
    assert.match((await one<{ code: string }>("select code from orders where id=$1", [order1])).code, /^OR-\d{4}$/);

    // Who may bid.
    await as(chefC);
    await assert.rejects(bid(order1, 2000), /outside the area/);
    await as(pending);
    await assert.rejects(bid(order1, 2000), /Only approved chefs/);
    await as(admin);
    await assert.rejects(bid(order1, 2000), /Only approved chefs/);
    await as(chefA);
    await assert.rejects(bid(order1, 4500), /budget/);
    await assert.rejects(bid(order1, 0), /between/);
    await bid(order1, 3000, "Happy to cook");
    await as(chefB);
    await bid(order1, 2500);
    await as(chefD);
    await bid(order1, 2500); // same price, later: loses the tie
    await as(chefB);
    await bid(order1, 2500, "Note only"); // same amount keeps B's place in line

    // Sealed: a chef sees only their own bid, and the address stays hidden.
    await as(chefA);
    assert.deepEqual((await db.query<{ amount: string }>("select amount from bids")).rows.map((r) => Number(r.amount)), [3000]);
    assert.equal((await db.query("select * from orders")).rows.length, 0, "chefs read orders only via list_orders");
    const seen = (await list("open")).rows[0];
    assert.equal(seen.address, null);
    assert.equal((seen.my_bid as { amount: number }).amount, 3000);
    assert.equal(seen.lowest_bid, undefined, "no competitor prices for chefs");
    await as(chefC);
    assert.equal((await list()).total, 0, "orders outside a chef's area are not listed");

    // Staff controls.
    await as(chefA);
    await assert.rejects(db.query("select close_bidding($1)", [order1]), /Manager access/);
    await assert.rejects(db.query("select record_deposit($1)", [order1]), /Manager access/);
    await assert.rejects(db.query("select cancel_order($1)", [order1]), /Manager access/);
    await assert.rejects(db.query("select * from order_bids($1)", [order1]), /Manager access/);
    await as(admin);
    await assert.rejects(db.query("select record_deposit($1)", [order1]), /Close bidding/);
    const staffRow = (await list("open")).rows.find((r) => r.id === order1)!;
    assert.deepEqual([staffRow.bid_count, Number(staffRow.lowest_bid)], [3, 2500]);
    await db.query("select close_bidding($1)", [order1]);
    const awarded = await one<{ status: string; chef_id: string }>(
      "select o.status, b.chef_id from orders o join bids b on b.id = o.winning_bid_id where o.id=$1", [order1]);
    assert.deepEqual(awarded, { status: "awarded", chef_id: chefB }, "cheapest wins; the tie goes to the earlier bid");
    assert.deepEqual(
      (await db.query<{ chef_id: string; status: string }>("select chef_id, status from bids where order_id=$1 order by chef_id", [order1])).rows,
      [{ chef_id: chefA, status: "lost" }, { chef_id: chefB, status: "won" }, { chef_id: chefD, status: "lost" }],
    );
    await as(chefB);
    const won = (await list("awarded")).rows[0];
    assert.equal(won.address, "12 Secret Lane", "the winner sees the address");
    await as(chefA);
    assert.equal((await list("awarded")).rows[0].address, null);
    await assert.rejects(bid(order1, 100), /closed/);

    // The award holds the chef: no overlapping manual booking before the deposit.
    await as(admin);
    const manual = (chef: string, start: number, end: number) =>
      db.query("select create_booking($1::jsonb)", [JSON.stringify({
        chef_id: chef, customer: "Walk-in", service: "Lunch", address: "Bengaluru", region: "Bengaluru", location: "Koramangala",
        guests: 2, scheduled_start: iso(start), scheduled_end: iso(end), base_amount: 1000, overtime_rate: 100, dish_ids: [],
      })]);
    await assert.rejects(manual(chefB, 49, 50), /already has a booking/);

    // Deposit: exactly 20%, then the chef is assigned an upcoming booking.
    const bookingId = (await one<{ b: string }>("select record_deposit($1) b", [order1])).b;
    const booking = await one<{ chef_id: string; status: string; base_amount: string; deposit_amount: string; order_id: string; address: string }>(
      "select chef_id,status,base_amount,deposit_amount,order_id,address from bookings where id=$1", [bookingId]);
    assert.deepEqual(
      { ...booking, base_amount: Number(booking.base_amount), deposit_amount: Number(booking.deposit_amount) },
      { chef_id: chefB, status: "upcoming", base_amount: 2500, deposit_amount: 500, order_id: order1, address: "12 Secret Lane" },
    );
    const confirmed = await one<{ status: string; deposit_amount: string; deposit_ref: string; booking_id: string }>(
      "select status,deposit_amount,deposit_ref,booking_id from orders where id=$1", [order1]);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(Number(confirmed.deposit_amount), 500);
    assert.match(confirmed.deposit_ref, /^SIM-OR-\d{4}$/);
    assert.equal(confirmed.booking_id, bookingId);
    await assert.rejects(db.query("select record_deposit($1)", [order1]), /already been recorded/);
    await assert.rejects(db.query("select cancel_order($1)", [order1]), /Only an open/);
    await as(chefB);
    assert.equal((await db.query("select * from bookings where id=$1", [bookingId])).rows.length, 1, "the chef sees the assigned booking");
    await as(chefA);
    assert.equal((await db.query("select * from bookings where id=$1", [bookingId])).rows.length, 0);

    // A busy chef cannot bid on an overlapping order.
    await as(admin);
    const order2 = await newOrder({ scheduled_start: iso(48.5), scheduled_end: iso(50) });
    await as(chefB);
    await assert.rejects(bid(order2, 1000), /already have a booking/);

    // Withdrawn bids do not count; an order without eligible bids is unfilled.
    await as(chefA);
    await bid(order2, 1200);
    await db.query("select withdraw_bid($1)", [order2]);
    await assert.rejects(db.query("select withdraw_bid($1)", [order2]), /no active bid/);
    await asSuper();
    await db.query("update orders set bid_deadline = now() - interval '1 second' where id=$1", [order2]);
    await as(chefD);
    await list(); // any listing settles due orders
    await asSuper();
    assert.equal((await one<{ status: string }>("select status from orders where id=$1", [order2])).status, "unfilled");

    // Two overlapping orders closing together: their shared cheapest chef wins
    // only the earlier deadline; the other goes to the next cheapest.
    await as(admin);
    const early = await newOrder({ scheduled_start: iso(100), scheduled_end: iso(103), bid_deadline: iso(1) });
    const late = await newOrder({ scheduled_start: iso(101), scheduled_end: iso(104), bid_deadline: iso(2) });
    await as(chefA);
    await bid(early, 1000);
    await bid(late, 1000);
    await as(chefD);
    await bid(early, 1500);
    await bid(late, 1600);
    await asSuper();
    await db.query("update orders set bid_deadline = now() - interval '1 minute' where id=$1", [early]);
    await db.query("update orders set bid_deadline = now() - interval '30 seconds' where id=$1", [late]);
    await as(admin);
    await db.query("select settle_orders()");
    const winner = async (order: string) =>
      (await one<{ chef_id: string }>("select b.chef_id from orders o join bids b on b.id=o.winning_bid_id where o.id=$1", [order])).chef_id;
    assert.equal(await winner(early), chefA);
    assert.equal(await winner(late), chefD);
    await db.query("select settle_orders()");
    assert.equal(await winner(late), chefD, "settling again changes nothing");

    // Chef search.
    type Search = { r: { rows: { id: string }[]; total: number } };
    const search = async (filter: Record<string, unknown>) =>
      (await one<Search>("select search_chefs($1::jsonb) r", [JSON.stringify(filter)])).r;
    const ids = (r: Search["r"]) => r.rows.map((x) => x.id).sort();
    assert.deepEqual(ids(await search({ region: "Bengaluru", location: "Whitefield" })), [chefB], "All locations serves every locality");
    assert.deepEqual(ids(await search({ region: "Bengaluru", location: "Koramangala" })), [chefA, chefB, chefD].sort());
    assert.deepEqual(ids(await search({ chef_type: "caterer" })), [chefC]);
    assert.deepEqual(ids(await search({ min_experience: 8 })), [chefA, chefC].sort());
    assert.equal((await search({})).total, 4, "pending chefs and staff are not listed");
    const busyWindow = await search({ region: "Bengaluru", start: iso(48), end: iso(49) });
    assert.ok(!ids(busyWindow).includes(chefB), "a chef with a booking in the window is unavailable");
    assert.ok(!ids(await search({ start: iso(100.5), end: iso(101) })).includes(chefA), "an award hold makes a chef unavailable");
    await assert.rejects(search({ start: iso(2), end: iso(1) }), /end must be after/);
    const paged = await one<Search>("select search_chefs('{}'::jsonb, 2, 2) r");
    assert.deepEqual([paged.r.rows.length, paged.r.total], [2, 4]);
    await as(chefA);
    await assert.rejects(search({}), /Manager access/);
    // Saving a chef profile requires a chef type.
    await assert.rejects(
      db.query("select save_profile($1::jsonb)", [JSON.stringify({ name: "A", phone: "", cuisine: "", experience: 8, online: true, region: "Bengaluru", location: "Koramangala", chef_type: "" })]),
      /chef type/,
    );
    await db.query("select save_profile($1::jsonb)", [JSON.stringify({ name: "A", phone: "", cuisine: "", experience: 8, online: false, region: "Bengaluru", location: "Koramangala" })]);
    await asSuper();
    assert.equal((await one<{ chef_type: string }>("select chef_type from profiles where id=$1", [chefA])).chef_type, "professional_chef", "omitting chef_type keeps it");
  } finally {
    await db.close();
  }
});

test("chef search and settlement stay fast with many chefs, bookings and a ten-year window", async (t) => {
  const db = await migrated();
  try {
    const admin = id(1);
    await db.query("insert into auth.users(id,email) values($1,'admin@t.dev')", [admin]);
    await db.query("update profiles set role='admin', approval_status='approved' where id=$1", [admin]);
    await db.exec(`
      insert into auth.users(id,email) select gen_random_uuid(), 'bulk' || i || '@t.dev' from generate_series(1,5000) i;
      update profiles set approval_status='approved', region='Bengaluru',
        location = (array['Koramangala','Whitefield','All locations'])[1 + (split_part(substr(email,5),'@',1)::int % 3)],
        chef_type = (array['home_cook','caterer','baker'])[1 + (length(email) % 3)],
        experience = (split_part(substr(email,5),'@',1)::int % 20)
      where email like 'bulk%';
      -- 20k bookings spread over ten years; 1 in 10 still open.
      insert into bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,base_amount,overtime_rate,status,region,location)
      select p.id, 'C', 'S', 'A', 2, t, t + interval '3 hours', 1000, 100,
        case when g % 10 = 0 then 'upcoming' else 'completed' end, 'Bengaluru', 'Koramangala'
      from (select id, row_number() over (order by id) rn from profiles where email like 'bulk%') p
      join generate_series(1,20000) g on p.rn = 1 + (g % 5000)
      cross join lateral (select now() - interval '5 years' + (g * interval '4 hours') t) x;
      -- 1000 orders whose bidding just closed, five bids each.
      insert into orders(customer,service,address,region,location,guests,scheduled_start,scheduled_end,bid_deadline,overtime_rate)
      select 'C', 'S', 'A', 'Bengaluru', 'All locations', 2, now() + (g * interval '6 hours'), now() + (g * interval '6 hours') + interval '3 hours',
        now() - interval '1 minute', 100
      from generate_series(1,1000) g;
      insert into bids(order_id,chef_id,amount,updated_at)
      select o.id, p.id, 1000 + k * 10 + (o.rn % 7), now() - interval '1 hour' + k * interval '1 second'
      from (select id, row_number() over (order by id) rn from orders) o
      cross join generate_series(0,4) k
      join (select id, row_number() over (order by id) rn from profiles where email like 'bulk%') p on p.rn = 1 + ((o.rn * 5 + k) % 5000);
    `);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);

    const filter = { region: "Bengaluru", location: "Whitefield", start: new Date(Date.now() - 5 * 365 * 864e5).toISOString(), end: new Date(Date.now() + 5 * 365 * 864e5).toISOString() };
    let started = performance.now();
    const wide = (await db.query<{ r: { total: number; rows: unknown[] } }>("select search_chefs($1::jsonb, 20, 0) r", [JSON.stringify(filter)])).rows[0].r;
    const searchMs = performance.now() - started;
    await db.exec("reset role");
    const expected = (await db.query<{ n: number }>(`
      select count(*)::int n from profiles p where p.role='chef' and p.approval_status='approved' and p.region='Bengaluru'
        and p.location in ('Whitefield','All locations')
        and not exists(select 1 from bookings b where b.chef_id=p.id and b.status not in ('completed','cancelled')
          and b.scheduled_start < $2 and b.scheduled_end > $1)
        and not exists(select 1 from bids w join orders o on o.id=w.order_id where w.chef_id=p.id and w.status='won' and o.status='awarded'
          and o.scheduled_start < $2 and o.scheduled_end > $1)`, [filter.start, filter.end])).rows[0].n;
    assert.equal(wide.total, expected, "the ten-year window matches a direct count");
    assert.equal(wide.rows.length, 20);

    await db.exec("set role authenticated");
    started = performance.now();
    await db.query("select settle_orders()");
    const settleMs = performance.now() - started;
    await db.exec("reset role");
    const counts = (await db.query<{ status: string; n: number }>("select status, count(*)::int n from orders group by status")).rows;
    assert.deepEqual(counts, [{ status: "awarded", n: 1000 }], "every due order with free bidders is awarded");
    const doubled = (await db.query<{ n: number }>(`
      select count(*)::int n from orders a join bids x on x.id=a.winning_bid_id
      join orders b on b.id<>a.id join bids y on y.id=b.winning_bid_id
      where x.chef_id=y.chef_id and a.scheduled_start < b.scheduled_end and a.scheduled_end > b.scheduled_start`)).rows[0].n;
    assert.equal(doubled, 0, "no chef wins two overlapping orders");
    t.diagnostic(`search_chefs ${Math.round(searchMs)} ms · settle_orders (1000 orders) ${Math.round(settleMs)} ms`);
    // Generous bounds for WASM Postgres; a per-day or per-row rescan would blow through them.
    assert.ok(searchMs < 10_000, `search_chefs took ${Math.round(searchMs)} ms`);
    assert.ok(settleMs < 20_000, `settle_orders took ${Math.round(settleMs)} ms`);
  } finally {
    await db.close();
  }
});
