import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Supabase migration enforces roles, booking workflow, photo evidence and server-calculated overtime", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
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
    await db.exec(await readFile(new URL("../supabase/migrations/202609190001_admin_cannot_create_tickets.sql", import.meta.url), "utf8"));
    await asUser(chef);
    assert.equal((await db.query("select * from dishes")).rows.length,0);
    assert.equal((await db.query("select * from bookings")).rows.length,0);
    assert.equal((await db.query<{approval_status:string}>("select approval_status from profiles where id=auth.uid()")).rows[0].approval_status,"pending");
    await assert.rejects(db.query("select review_member($1,'approved')",[chef]),/Administrator/);
    await assert.rejects(db.query("update profiles set approval_status='approved' where id=auth.uid()"),/permission denied/);
    await asUser(admin);
    await db.query("select review_member($1,'approved')",[chef]);
    await assert.rejects(
      db.query(
        "insert into tickets(user_id,subject,message,status) values(auth.uid(),'Admin ticket','This must be rejected','open')",
      ),
      /row-level security/,
      "an administrator cannot raise a support ticket",
    );
    await asUser(chef);
    assert.ok((await db.query("select * from dishes")).rows.length>0);
    await asUser(admin);
    await db.query("select review_member($1,'rejected')",[chef]);
    await asUser(chef);
    assert.equal((await db.query("select * from bookings")).rows.length,0);

    // Service areas: chef location is mandatory, bookings carry a location and a short code.
    await db.exec("reset role");
    await db.exec(await readFile(new URL("../supabase/migrations/202609180003_service_areas.sql", import.meta.url), "utf8"));
    await asUser(admin);
    await db.query("select review_member($1,'approved')",[chef]);
    assert.match(
      (await db.query<{code:string}>("select code from bookings order by code limit 1")).rows[0].code,
      /^CF-\d{4}$/,
      "existing bookings receive a short booking code",
    );
    await asUser(chef);
    await assert.rejects(
      db.query("select save_profile($1::jsonb)",[JSON.stringify({name:"Chef",phone:"",cuisine:"",experience:1,online:true,region:"",location:""})]),
      /region and location/,
      "a chef cannot save a profile without a location",
    );
    await assert.rejects(
      db.query("select save_profile($1::jsonb)",[JSON.stringify({name:"Chef",phone:"",cuisine:"",experience:1,online:true,region:"Bengaluru",location:"Nowhere"})]),
      /from the list/,
      "locations outside the service-area list are rejected",
    );
    await db.query("select save_profile($1::jsonb)",[JSON.stringify({name:"Chef",phone:"",cuisine:"",experience:1,online:true,region:"Bengaluru",location:"Koramangala"})]);
    assert.equal(
      (await db.query<{location:string}>("select location from profiles where id=auth.uid()")).rows[0].location,
      "Koramangala",
    );
    await asUser(admin);
    const newBooking = (extra: Record<string, unknown>) =>
      db.query("select create_booking($1::jsonb)",[JSON.stringify({
        chef_id: chef, customer:"Area customer", service:"Dinner", address:"Bengaluru", guests:4,
        scheduled_start:"2030-05-01T10:00:00Z", scheduled_end:"2030-05-01T12:00:00Z",
        base_amount:1000, overtime_rate:300, dish_ids:[], ...extra,
      })]);
    await assert.rejects(newBooking({}),/region and location/,"a booking needs a service location");
    await assert.rejects(newBooking({region:"Bengaluru",location:"Atlantis"}),/from the list/);
    await newBooking({region:"Bengaluru",location:"Koramangala"});
    const created = (await db.query<{code:string;location:string}>("select code,location from bookings where customer='Area customer'")).rows[0];
    assert.equal(created.location,"Koramangala");
    assert.match(created.code,/^CF-\d{4}$/);
    await asUser(chef);
    await assert.rejects(
      db.query("select save_service_area('Bengaluru','Chef Town')"),
      /Administrator/,
      "only an administrator may edit the service-area list",
    );

    // SMS login: profile mobiles are validated and unique; lookup and token
    // receipts are server-only.
    await db.exec("reset role");
    await db.exec(await readFile(new URL("../supabase/migrations/202609260001_sms_login.sql", import.meta.url), "utf8"));
    const profileWith = (phone: string, region = "Bengaluru", location = "Koramangala") =>
      db.query("select save_profile($1::jsonb)",[JSON.stringify({name:"Chef",phone,cuisine:"",experience:1,online:true,region,location})]);
    await asUser(chef);
    await assert.rejects(profileWith("12345"),/valid 10-digit/,"an invalid mobile is rejected");
    await profileWith("+91 98765 43210");
    await asUser(admin);
    await assert.rejects(profileWith("098765-43210","",""),/already used/,"one mobile cannot belong to two members");
    await profileWith("","","");
    await assert.rejects(db.query("select * from sms_login_accounts('919876543210')"),/permission denied/);
    await assert.rejects(db.query("select claim_sms_login('x')"),/permission denied/);
    await assert.rejects(db.query("select * from sms_login_receipts"),/permission denied/);
    await db.exec("reset role");
    await db.exec("set role service_role");
    const accounts = await db.query<{id:string}>("select * from sms_login_accounts('9876543210')");
    assert.deepEqual(accounts.rows.map((r) => r.id),[chef],"a verified mobile finds its member in any format");
    assert.equal((await db.query("select * from sms_login_accounts('919999999999')")).rows.length,0);
    assert.equal((await db.query<{ok:boolean}>("select claim_sms_login('hash-1') ok")).rows[0].ok,true);
    assert.equal((await db.query<{ok:boolean}>("select claim_sms_login('hash-1') ok")).rows[0].ok,false,"an MSG91 token opens one session only");
    await db.exec("reset role");

    // SMS rate limits: fixed-window counters, server-only.
    await db.exec(await readFile(new URL("../supabase/migrations/202609260002_sms_rate_limits.sql", import.meta.url), "utf8"));
    await asUser(chef);
    await assert.rejects(db.query("select sms_rate_hit('k',1,60)"),/permission denied/);
    await db.exec("reset role");
    await db.exec("set role service_role");
    const hit = async (key: string, limit: number) =>
      (await db.query<{ok:boolean}>("select sms_rate_hit($1,$2,86400) ok",[key,limit])).rows[0].ok;
    assert.deepEqual([await hit("send:phone:1",2),await hit("send:phone:1",2),await hit("send:phone:1",2)],[true,true,false],"the third send in the window is refused");
    assert.equal(await hit("send:phone:2",2),true,"limits are per key");
    await db.exec("reset role");

    // Email + verified mobile on one account; sign-up by mobile.
    await db.exec(await readFile(new URL("../supabase/migrations/202609260003_phone_signup.sql", import.meta.url), "utf8"));
    const asService = async () => { await db.exec("reset role"); await db.exec("set role service_role"); };
    const loginIds = async (phone: string) => { await asService(); return (await db.query<{id:string}>("select id from sms_login_accounts($1)",[phone])).rows.map((r) => r.id); };
    assert.deepEqual(await loginIds("9876543210"),[],"a typed-in, unverified mobile does not sign in");
    await asUser(chef);
    await assert.rejects(db.query("select set_verified_mobile($1,'+919876543210')",[chef]),/permission denied/,"only the server verifies mobiles");
    await asService();
    await db.query("select set_verified_mobile($1,'98765 43210')",[chef]);
    assert.deepEqual(await loginIds("+91 98765 43210"),[chef],"a verified mobile signs into the account that verified it");
    await assert.rejects(db.query("select set_verified_mobile($1,'9876543210')",[admin]),/already used/,"a verified mobile belongs to one account");
    await asUser(chef);
    await profileWith("+919876543210");
    assert.equal((await db.query<{v:boolean}>("select phone_verified v from profiles where id=auth.uid()")).rows[0].v,true,"re-saving the same number keeps it verified");
    await profileWith("9123456780");
    assert.equal((await db.query<{v:boolean}>("select phone_verified v from profiles where id=auth.uid()")).rows[0].v,false,"a changed number must be verified again");
    assert.deepEqual(await loginIds("9876543210"),[]);

    await db.exec("reset role"); // Auth creates the user; the server then marks it
    const mobileOnly = "10000000-0000-4000-8000-000000000009";
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'phone-x@phone.invalid','{\"name\":\"Mobile Member\"}')",[mobileOnly]);
    await asService();
    await db.query("select mark_phone_account($1,'+919000000001')",[mobileOnly]);
    await db.exec("reset role");
    const member = (await db.query<{email:string|null;phone:string;phone_verified:boolean;approval_status:string}>("select email,phone,phone_verified,approval_status from profiles where id=$1",[mobileOnly])).rows[0];
    assert.deepEqual(member,{email:null,phone:"+919000000001",phone_verified:true,approval_status:"pending"},"a mobile sign-up has no email and awaits approval");
    assert.deepEqual(await loginIds("9000000001"),[mobileOnly]);
    await asUser(mobileOnly);
    await assert.rejects(profileWith("9111111111"),/cannot be changed/,"a mobile-only member cannot drop their only sign-in");
    await profileWith("+91 90000 00001");
    await db.exec("reset role");
    await db.query("update auth.users set email='mobile.member@test.dev' where id=$1",[mobileOnly]);
    assert.equal((await db.query<{email:string}>("select email from profiles where id=$1",[mobileOnly])).rows[0].email,"mobile.member@test.dev","a confirmed email becomes a second sign-in on the same profile");
    assert.deepEqual(await loginIds("9000000001"),[mobileOnly],"the mobile still signs in after an email is added");
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
