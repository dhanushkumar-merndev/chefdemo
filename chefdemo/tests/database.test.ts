import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Supabase migration enforces roles, booking workflow, photo evidence and server-calculated overtime", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text default auth.uid()::text);
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon;
      grant select,insert,delete on storage.objects to authenticated;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609080001_chefflow.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "10000000-0000-4000-8000-000000000001",
      chef = "10000000-0000-4000-8000-000000000002",
      other = "10000000-0000-4000-8000-000000000003";
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@test.dev','{}'),($2,'chef@test.dev','{\"role\":\"admin\"}'),($3,'other@test.dev','{}')",
      [admin, chef, other],
    );
    const roles = await db.query<{ role: string }>(
      "select role from profiles where id=$1",
      [chef],
    );
    assert.equal(
      roles.rows[0].role,
      "chef",
      "signup metadata must not grant admin access",
    );
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    const asUser = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
    };
    await asUser(admin);
    const dish = (
      await db.query<{ id: string }>("select id from dishes limit 1")
    ).rows[0].id;
    await db.query("select create_booking($1::jsonb)", [
      JSON.stringify({
        chef_id: chef,
        customer: "Test customer",
        service: "Dinner",
        address: "Bengaluru",
        guests: 10,
        scheduled_start: "2020-01-01T10:00:00Z",
        scheduled_end: "2020-01-01T11:00:00Z",
        base_amount: 1000,
        overtime_rate: 300,
        dish_ids: [dish],
      }),
    ]);
    const id = (await db.query<{ id: string }>("select id from bookings"))
      .rows[0].id;
    await asUser(other);
    assert.equal(
      (await db.query("select * from bookings")).rows.length,
      0,
      "chef cannot read another chef's booking",
    );
    await assert.rejects(
      db.query("select booking_action($1,'accept')", [id]),
      /access denied/,
    );
    await assert.rejects(
      db.query("select set_staff_role($1,'admin')", [other]),
      /Administrator/,
    );
    await assert.rejects(
      db.query("update profiles set role='admin' where id=$1", [other]),
      /permission denied/,
    );
    await asUser(chef);
    await db.query("select booking_action($1,'accept')", [id]);
    await assert.rejects(
      db.query("select booking_action($1,'check_in')", [id]),
      /photos/,
    );
    await assert.rejects(
      db.query("update bookings set overtime_amount=1 where id=$1", [id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into service_photos(booking_id,stage,path) values($1,'entry',$2)",
        [id, `${id}/entry/missing.jpg`],
      ),
      /Upload the photo/,
    );
    for (const stage of ["entry", "before"]) {
      const path = `${id}/${stage}/test.jpg`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('kitchen-photos',$1)",
        [path],
      );
      await db.query(
        "insert into service_photos(booking_id,stage,path) values($1,$2,$3)",
        [id, stage, path],
      );
    }
    await db.query("select booking_action($1,'check_in')", [id]);
    await assert.rejects(
      db.query("select booking_action($1,'complete')", [id]),
      /four/,
    );
    for (const stage of ["preparing", "after"]) {
      const path = `${id}/${stage}/test.jpg`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('kitchen-photos',$1)",
        [path],
      );
      await db.query(
        "insert into service_photos(booking_id,stage,path) values($1,$2,$3)",
        [id, stage, path],
      );
    }
    await db.query("select booking_action($1,'complete')", [id]);
    const result = await db.query<{
      status: string;
      overtime_amount: string;
      valid_charge: boolean;
    }>(
      "select status,overtime_amount,overtime_amount = round(ceil(extract(epoch from(actual_out-scheduled_end))/60)*overtime_rate/60,2) valid_charge from bookings where id=$1",
      [id],
    );
    assert.equal(result.rows[0].status, "completed");
    assert.equal(result.rows[0].valid_charge, true);
    await assert.rejects(
      db.query("select booking_action($1,'complete')", [id]),
      /Check in/,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('kitchen-photos',$1)",
        [`${id}/after/new.jpg`],
      ),
      /row-level security/,
    );
    await asUser(admin);
    await db.query(
      "select authorize_staff('New manager','new@test.dev','manager')",
    );
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values(gen_random_uuid(),'new@test.dev')",
    );
    assert.equal(
      (
        await db.query<{ role: string }>(
          "select role from profiles where email='new@test.dev'",
        )
      ).rows[0].role,
      "manager",
    );
    await db.exec(await readFile(new URL("../supabase/migrations/202609080002_member_approval.sql", import.meta.url), "utf8"));
    await asUser(chef);
    assert.equal((await db.query("select * from dishes")).rows.length,0);
    assert.equal((await db.query("select * from bookings")).rows.length,0);
    assert.equal((await db.query<{approval_status:string}>("select approval_status from profiles where id=auth.uid()")).rows[0].approval_status,"pending");
    await assert.rejects(db.query("select review_member($1,'approved')",[chef]),/Administrator/);
    await assert.rejects(db.query("update profiles set approval_status='approved' where id=auth.uid()"),/permission denied/);
    await asUser(admin);
    await db.query("select review_member($1,'approved')",[chef]);
    await asUser(chef);
    assert.ok((await db.query("select * from dishes")).rows.length>0);
    await asUser(admin);
    await db.query("select review_member($1,'rejected')",[chef]);
    await asUser(chef);
    assert.equal((await db.query("select * from bookings")).rows.length,0);
  } finally {
    await db.close();
  }
});
