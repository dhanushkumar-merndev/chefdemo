import { test } from "node:test";
import assert from "node:assert/strict";
import { fromIstInput, istInputValue, orderChangeAllowed, type NewOrder } from "../src/lib/domain";
import { seedData } from "../src/lib/seed";
import localities from "../src/lib/localities.json";

test("once a chef bids, only the details they did not price can change", () => {
  const order = seedData().orders[0];
  const same: NewOrder = { ...order, address: order.address! };
  assert.ok(orderChangeAllowed(order, { ...same, guests: 99 }, false), "anything goes before a bid");
  assert.ok(orderChangeAllowed(order, { ...same, customer: "New", address: "New", notes: "x", dish_ids: [], bid_deadline: order.scheduled_start }, true));
  for (const change of [
    { location: "Whitefield" },
    { region: "Mumbai" },
    { guests: order.guests + 1 },
    { max_budget: 1 },
    { overtime_rate: order.overtime_rate + 1 },
    { scheduled_start: new Date(Date.parse(order.scheduled_start) + 60_000).toISOString() },
    { scheduled_end: new Date(Date.parse(order.scheduled_end) + 60_000).toISOString() },
  ])
    assert.equal(orderChangeAllowed(order, { ...same, ...change }, true), false, JSON.stringify(change));
  // The same instant written differently is not a change.
  assert.ok(orderChangeAllowed(order, { ...same, scheduled_start: new Date(order.scheduled_start).toJSON() }, true));
});

test("IST form values round-trip", () => {
  assert.equal(istInputValue("2026-10-22T09:03:00.000Z"), "2026-10-22T14:33");
  assert.equal(fromIstInput("2026-10-22T14:33"), "2026-10-22T09:03:00.000Z");
});

test("the downloaded locality list is clean", () => {
  const list = localities as Record<string, string[]>;
  assert.deepEqual(Object.keys(list).sort(), ["Bengaluru", "Chennai", "Delhi", "Hyderabad", "Mumbai", "Rajasthan"]);
  for (const [region, names] of Object.entries(list)) {
    assert.ok(names.length > 150, `${region} has only ${names.length} localities`);
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `${region} has duplicates`);
    for (const name of names) {
      assert.ok(name.length >= 2 && name.length <= 80, `${region}: "${name}"`);
      assert.ok(!/[^\x20-\x7E]/.test(name), `${region}: non-Latin "${name}"`);
      assert.ok(!/^(\d+(st|nd|rd|th)? (block|phase|stage|sector)|(sector|pocket|block) \w{1,4})$/i.test(name), `${region}: context-free "${name}"`);
    }
  }
  for (const [region, name] of [["Bengaluru", "Koramangala"], ["Bengaluru", "Whitefield"], ["Hyderabad", "Gachibowli"], ["Mumbai", "Powai"], ["Delhi", "Saket"], ["Rajasthan", "Jaipur"]])
    assert.ok(list[region].includes(name), `${region} is missing ${name}`);
});
