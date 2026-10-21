import { test } from "node:test";
import assert from "node:assert/strict";
import { migrated } from "./pg";
import localities from "../src/lib/localities.json";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

test("admin editing: full locality list, chef details, open orders and location renames", async () => {
  const db = await migrated();
  try {
    const [admin, manager, chef, other] = [1, 2, 3, 4].map(id);
    await db.query(
      "insert into auth.users(id,email) values ($1,'admin@t.dev'),($2,'manager@t.dev'),($3,'chef@t.dev'),($4,'other@t.dev')",
      [admin, manager, chef, other],
    );
    await db.query("update profiles set approval_status='approved'");
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    await db.query("update profiles set role='manager' where id=$1", [manager]);
    await db.query(
      "update profiles set region='Bengaluru', location='Koramangala', chef_type='home_cook', experience=4 where id in ($1,$2)",
      [chef, other],
    );
    const as = async (who: string) => {
      await db.exec("reset role");
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
    };
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

    // The generated migration loads every downloaded locality, and the list
    // comes back whole in one call (no 1,000-row cap).
    const downloaded = Object.values(localities as Record<string, string[]>).reduce((n, names) => n + names.length, 0);
    await as(chef);
    const list = (await one<{ l: { region: string; name: string; active: boolean }[] }>("select service_area_list() l")).l;
    assert.ok(list.length >= downloaded, `expected at least ${downloaded} areas, got ${list.length}`);
    assert.ok(list.length > 1000);
    assert.ok(list.some((a) => a.region === "Bengaluru" && a.name === "Banashankari"));
    assert.ok(list.some((a) => a.region === "Delhi" && a.name === "Saket"));
    assert.equal(
      new Set(list.map((a) => `${a.region}|${a.name.toLowerCase()}`)).size,
      list.length,
      "no duplicate localities",
    );
    await db.exec("reset role");
    await db.query("update profiles set approval_status='pending' where id=$1", [other]);
    await as(other);
    assert.deepEqual((await one<{ l: unknown[] }>("select service_area_list() l")).l, [], "unapproved members get no list");

    // Editing a chef: administrators only, chefs only, validated.
    const edit = (who: string, input: Record<string, unknown>) =>
      db.query("select admin_update_chef($1,$2::jsonb)", [who, JSON.stringify({
        name: "Chef Edited", region: "Bengaluru", location: "Whitefield", chef_type: "caterer", experience: 9, cuisine: "Kerala", online: false, ...input,
      })]);
    await as(manager);
    await assert.rejects(edit(chef, {}), /Administrator access/);
    await as(chef);
    await assert.rejects(edit(chef, {}), /Administrator access/);
    await as(admin);
    await assert.rejects(edit(manager, {}), /Chef not found/);
    await assert.rejects(edit(chef, { location: "Atlantis" }), /from the list/);
    await assert.rejects(edit(chef, { chef_type: "wizard" }), /chef type/);
    await assert.rejects(edit(chef, { experience: 81 }), /between 0 and 80/);
    await assert.rejects(edit(chef, { name: " " }), /name/);
    await edit(chef, {});
    await db.exec("reset role");
    assert.deepEqual(
      await one("select name, location, chef_type, experience, cuisine, online from profiles where id=$1", [chef]),
      { name: "Chef Edited", location: "Whitefield", chef_type: "caterer", experience: 9, cuisine: "Kerala", online: false },
    );

    // Editing an order: staff only, open only; once a chef bids, the priced terms lock.
    const base = {
      customer: "Pradeep Kumar", service: "Dinner", address: "17-91-D-9, Nemali Nagar", region: "Bengaluru", location: "Whitefield",
      guests: 10, scheduled_start: iso(48), scheduled_end: iso(51), bid_deadline: iso(24), overtime_rate: 300, max_budget: 5000,
      dish_ids: [], notes: "",
    };
    await as(manager);
    const order = (await one<{ id: string }>("select create_order($1::jsonb) id", [JSON.stringify(base)])).id;
    const update = (input: Record<string, unknown>) =>
      db.query("select update_order($1,$2::jsonb)", [order, JSON.stringify({ ...base, ...input })]);
    const stored = () => one<{ guests: number; customer: string }>("select guests, customer from orders where id=$1", [order]);
    await as(chef);
    await assert.rejects(update({}), /Manager access/);
    await as(admin);
    await assert.rejects(update({ bid_deadline: iso(-1) }), /deadline must be in the future/);
    await assert.rejects(update({ guests: 0 }), /between 1 and 500/);
    await update({ guests: 14, location: "Koramangala" }); // no bids yet: anything may change
    assert.equal((await stored()).guests, 14);
    await db.exec("reset role");
    await db.query("update profiles set location='Koramangala' where id=$1", [chef]);
    await as(chef);
    await db.query("select place_bid($1, 4000, '')", [order]);
    await as(admin);
    const locked = /Chefs have already bid/;
    await assert.rejects(update({ guests: 20, location: "Koramangala" }), locked);
    await assert.rejects(update({ guests: 14, location: "Whitefield" }), locked);
    await assert.rejects(update({ guests: 14, location: "Koramangala", max_budget: 3000 }), locked);
    await assert.rejects(update({ guests: 14, location: "Koramangala", overtime_rate: 400 }), locked);
    await update({ guests: 14, location: "Koramangala", customer: "Pradeep K.", bid_deadline: iso(30), notes: "Gate code 42" });
    assert.equal((await stored()).customer, "Pradeep K.", "details and deadline stay editable after a bid");
    await db.query("select close_bidding($1)", [order]);
    await assert.rejects(update({ guests: 14, location: "Koramangala" }), /open for bids/);

    // Renaming a location carries over to chefs, open orders and unfinished
    // bookings, but not completed history. Administrators only.
    await db.exec("reset role");
    const area = (await one<{ id: string }>("select id from service_areas where region='Bengaluru' and name='Koramangala'")).id;
    const done = (await one<{ id: string }>(`insert into bookings(chef_id,customer,service,address,guests,scheduled_start,scheduled_end,
      base_amount,overtime_rate,status,region,location) values($1,'Old','S','A',2,now()-interval '9 days',now()-interval '9 days'+interval '1 hour',
      100,10,'completed','Bengaluru','Koramangala') returning id`, [chef])).id;
    await as(manager);
    await assert.rejects(db.query("select rename_service_area($1,'Koramangala 2')", [area]), /Administrator access/);
    await as(admin);
    await assert.rejects(db.query("select rename_service_area($1,'whitefield')", [area]), /already exists in Bengaluru/);
    const all = (await one<{ id: string }>("select id from service_areas where region='Bengaluru' and name='All locations'")).id;
    await assert.rejects(db.query("select rename_service_area($1,'Everywhere')", [all]), /built-in/);
    await db.query("select rename_service_area($1,'Koramangala Block 1')", [area]);
    await db.exec("reset role");
    assert.equal((await one<{ location: string }>("select location from profiles where id=$1", [chef])).location, "Koramangala Block 1");
    assert.equal((await one<{ location: string }>("select location from orders where id=$1", [order])).location, "Koramangala Block 1");
    assert.equal((await one<{ location: string }>("select location from bookings where id=$1", [done])).location, "Koramangala", "history keeps its name");
    // Turning a location off hides it from new choices; existing users keep it.
    await as(admin);
    await db.query("select save_service_area('Bengaluru','Koramangala Block 1',false)");
    await as(chef);
    await assert.rejects(
      db.query("select save_profile($1::jsonb)", [JSON.stringify({ name: "C", phone: "", cuisine: "", experience: 1, online: true, region: "Bengaluru", location: "Koramangala Block 1", chef_type: "caterer" })]),
      /from the list/,
    );
    await as(admin);
    await edit(chef, { location: "Koramangala Block 1" }); // unchanged area is allowed even when turned off
  } finally {
    await db.close();
  }
});
