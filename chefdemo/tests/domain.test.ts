import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overtime,
  transition,
  csvCell,
  validateBooking,
  stages,
  type Photo,
  type Booking,
} from "../src/lib/domain";
import { seedData } from "../src/lib/seed";

test("overtime handles boundaries, rounding, overnight services and final timestamps", () => {
  const b = {
    ...seedData().bookings[0],
    actual_in: "2026-09-08T20:00:00Z",
    scheduled_end: "2026-09-08T23:30:00Z",
    overtime_rate: 300,
  };
  assert.deepEqual(overtime(b, Date.parse(b.scheduled_end)), {
    minutes: 0,
    amount: 0,
  });
  assert.deepEqual(overtime(b, Date.parse(b.scheduled_end) + 1), {
    minutes: 1,
    amount: 5,
  });
  assert.deepEqual(overtime({ ...b, actual_out: "2026-09-09T00:00:00Z" }), {
    minutes: 30,
    amount: 150,
  });
  assert.equal(
    overtime({ ...b, actual_in: null }, Date.parse(b.scheduled_end) + 60000)
      .amount,
    0,
  );
  assert.equal(
    overtime({ ...b, overtime_rate: 100 }, Date.parse(b.scheduled_end) + 60000)
      .amount,
    1.67,
  );
});
test("service completion requires saved menu and all four photo stages", () => {
  const b: Booking = { ...seedData().bookings[0], dish_ids: [] };
  assert.throws(() => transition(b, "check_in", [], []), /dishes/);
  b.dish_ids = ["dish"];
  assert.throws(() => transition(b, "check_in", [], []), /photos/);
  const photos: Photo[] = stages.map((stage) => ({
    id: stage,
    stage,
    booking_id: b.id,
    path: "image",
    created_at: new Date().toISOString(),
  }));
  const active = transition(
    b,
    "check_in",
    photos.slice(0, 2),
    [],
    Date.parse(b.scheduled_start),
  );
  assert.throws(
    () => transition(active, "complete", photos.slice(0, 3), []),
    /four/,
  );
  const complete = transition(
    active,
    "complete",
    photos,
    [],
    Date.parse(b.scheduled_end) + 1800000,
  );
  assert.equal(complete.overtime_amount, 150);
  assert.throws(() => transition(complete, "complete", photos, []), /Check in/);
  assert.throws(
    () => transition(complete, "save_dishes", photos, ["other"]),
    /locked/,
  );
});
test("booking inputs reject invalid schedules and amounts", () => {
  const b = seedData().bookings[0];
  assert.throws(
    () => validateBooking({ ...b, scheduled_end: b.scheduled_start }),
    /after/,
  );
  assert.throws(() => validateBooking({ ...b, overtime_rate: -1 }), /amounts/);
  assert.throws(() => validateBooking({ ...b, guests: 0 }), /Guest/);
});
test("CSV values cannot execute spreadsheet formulas and quotes are escaped", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("Normal, name"), '"Normal, name"');
});
