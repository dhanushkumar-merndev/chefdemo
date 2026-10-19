import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chefBusy,
  depositFor,
  matchesChefFilter,
  pickWinner,
  settleOrders,
  validateBid,
  validateOrder,
  type Bid,
  type ChefFilter,
  type NewOrder,
  type Order,
  type Profile,
} from "../src/lib/domain";
import { seedData } from "../src/lib/seed";

const at = (minutes: number) =>
  new Date(Date.UTC(2030, 0, 1) + minutes * 60_000).toISOString();
const NOW = Date.UTC(2030, 0, 1);
const bid = (id: string, chef: string, amount: number, minute: number, extra: Partial<Bid> = {}): Bid => ({
  id,
  order_id: "o1",
  chef_id: chef,
  amount,
  message: "",
  status: "active",
  created_at: at(minute),
  updated_at: at(minute),
  ...extra,
});
const order = (id: string, startMin: number, deadlineMin: number, extra: Partial<Order> = {}): Order => ({
  id,
  code: `OR-${id}`,
  customer: "Client",
  service: "Dinner",
  address: "Koramangala",
  region: "Bengaluru",
  location: "Koramangala",
  guests: 4,
  scheduled_start: at(startMin),
  scheduled_end: at(startMin + 120),
  bid_deadline: at(deadlineMin),
  overtime_rate: 300,
  max_budget: null,
  dish_ids: [],
  notes: "",
  status: "open",
  winning_bid_id: null,
  deposit_amount: 0,
  booking_id: null,
  created_at: at(-100),
  ...extra,
});
const chef = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name: id,
  email: `${id}@test.dev`,
  role: "chef",
  phone: "",
  cuisine: "",
  experience: 5,
  online: true,
  region: "Bengaluru",
  location: "Koramangala",
  chef_type: "home_cook",
  ...extra,
});

test("the cheapest eligible bid wins; ties go to the earliest offer", () => {
  const bids = [
    bid("b1", "a", 3000, 1),
    bid("b2", "b", 2500, 5),
    bid("b3", "c", 2500, 2),
    bid("b4", "d", 1000, 0, { status: "withdrawn" }),
  ];
  assert.equal(pickWinner(bids, () => true)?.id, "b3", "equal price → earliest");
  assert.equal(pickWinner(bids, (b) => b.chef_id !== "c")?.id, "b2", "busy chefs are skipped");
  assert.equal(pickWinner(bids.slice(3), () => true), null, "withdrawn bids never win");
  assert.equal(pickWinner([], () => true), null);
});

test("the deposit is 20% of the winning bid, to the paisa", () => {
  assert.equal(depositFor(2500), 500);
  assert.equal(depositFor(1750), 350);
  assert.equal(depositFor(2412.35), 482.47);
  assert.equal(depositFor(0.05), 0.01);
  assert.equal(depositFor(999999.99), 200000);
  // Bids are whole paise, so 20% is never a half paisa: no rounding ties.
  for (let paise = 100; paise < 2000; paise++)
    assert.equal(depositFor(paise / 100), Math.round(paise * 0.2) / 100);
});

test("orders need a future deadline before the service and a sensible budget", () => {
  const ok: NewOrder = {
    customer: "Client",
    service: "Dinner",
    address: "Koramangala",
    region: "Bengaluru",
    location: "Koramangala",
    guests: 4,
    scheduled_start: at(600),
    scheduled_end: at(720),
    bid_deadline: at(60),
    overtime_rate: 300,
    max_budget: null,
    dish_ids: [],
    notes: "",
  };
  validateOrder(ok, NOW);
  validateOrder({ ...ok, bid_deadline: ok.scheduled_start }, NOW);
  assert.throws(() => validateOrder({ ...ok, bid_deadline: at(0) }, NOW), /future/);
  assert.throws(() => validateOrder({ ...ok, bid_deadline: at(601) }, NOW), /before the service/);
  assert.throws(() => validateOrder({ ...ok, scheduled_end: ok.scheduled_start }, NOW), /after in time/);
  assert.throws(() => validateOrder({ ...ok, max_budget: 0 }, NOW), /budget/);
  assert.throws(() => validateOrder({ ...ok, location: "" }, NOW), /region and location/);
});

test("bids close at the deadline and respect the budget", () => {
  const o = order("o1", 600, 60, { max_budget: 3000 });
  validateBid(o, 3000, NOW);
  assert.throws(() => validateBid(o, 3000.01, NOW), /budget/);
  assert.throws(() => validateBid(o, 0, NOW), /between/);
  assert.throws(() => validateBid(o, 2000, Date.parse(o.bid_deadline)), /closed/);
  assert.throws(() => validateBid({ ...o, status: "awarded" }, 2000, NOW), /closed/);
});

test("settling awards the cheapest free chef, never two overlapping orders to one chef", () => {
  const profiles = [chef("a"), chef("b"), chef("c", { approval_status: "rejected" })];
  // o1 and o2 overlap; a is cheapest on both. o3 has no bids.
  const orders = [order("o1", 600, -10), order("o2", 630, -5), order("o3", 600, -5), order("o4", 600, 60)];
  const bids = [
    bid("b1", "a", 1000, 1, { order_id: "o1" }),
    bid("b2", "b", 1500, 2, { order_id: "o1" }),
    bid("b3", "a", 900, 1, { order_id: "o2" }),
    bid("b4", "b", 1400, 3, { order_id: "o2" }),
    bid("b5", "c", 100, 0, { order_id: "o2" }),
    bid("b6", "a", 500, 0, { order_id: "o4" }),
  ];
  const result = settleOrders({ bookings: [], orders, bids, profiles }, NOW);
  const o = (id: string) => result.orders.find((x) => x.id === id)!;
  const b = (id: string) => result.bids.find((x) => x.id === id)!;
  assert.equal(o("o1").status, "awarded");
  assert.equal(o("o1").winning_bid_id, "b1", "earliest deadline gets chef a first");
  assert.equal(o("o2").winning_bid_id, "b4", "a is now held, so o2 goes to b; rejected c is skipped");
  assert.deepEqual([b("b1").status, b("b2").status, b("b3").status, b("b4").status], ["won", "lost", "lost", "won"]);
  assert.equal(o("o3").status, "unfilled");
  assert.equal(o("o4").status, "open", "orders before their deadline are untouched");
  assert.equal(orders[0].status, "open", "inputs are not mutated");
  const again = settleOrders({ bookings: [], orders: result.orders, bids: result.bids, profiles }, NOW);
  assert.deepEqual(again, result, "settling twice changes nothing");
});

test("an award holds the chef until the deposit; existing bookings block bids", () => {
  const seed = seedData();
  const awarded = seed.orders.find((o) => o.status === "awarded")!;
  const winner = seed.bids.find((b) => b.id === awarded.winning_bid_id)!;
  assert.ok(chefBusy(seed, winner.chef_id, awarded.scheduled_start, awarded.scheduled_end));
  assert.ok(
    !chefBusy(seed, winner.chef_id, awarded.scheduled_start, awarded.scheduled_end, awarded.id),
    "the deposit check ignores the order's own hold",
  );
  const upcoming = seed.bookings.find((b) => b.status === "upcoming")!;
  assert.ok(chefBusy(seed, upcoming.chef_id, upcoming.scheduled_start, upcoming.scheduled_end));
  assert.ok(!chefBusy(seed, upcoming.chef_id, "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z"));
});

test("chef search filters by area, type, experience, online and availability", () => {
  const all: ChefFilter = { region: "", location: "", chef_type: "", min_experience: 0, start: "", end: "", online_only: false };
  const free = () => false;
  const anywhere = chef("x", { location: "All locations" });
  const ncr = chef("n", { region: "Delhi", location: "NCR" });
  assert.ok(matchesChefFilter(anywhere, { ...all, region: "Bengaluru", location: "Whitefield" }, free));
  assert.ok(!matchesChefFilter(chef("k"), { ...all, region: "Bengaluru", location: "Whitefield" }, free));
  assert.ok(matchesChefFilter(ncr, { ...all, region: "Delhi", location: "Gurugram" }, free), "NCR covers Delhi localities");
  assert.ok(!matchesChefFilter(ncr, { ...all, region: "Mumbai" }, free));
  assert.ok(matchesChefFilter(chef("e"), { ...all, min_experience: 5 }, free));
  assert.ok(!matchesChefFilter(chef("e"), { ...all, min_experience: 6 }, free));
  assert.ok(!matchesChefFilter(chef("t"), { ...all, chef_type: "baker" }, free));
  assert.ok(!matchesChefFilter(chef("o", { online: false }), { ...all, online_only: true }, free));
  assert.ok(!matchesChefFilter(chef("p", { approval_status: "pending" }), all, free));
  assert.ok(!matchesChefFilter({ ...chef("s"), role: "manager" }, all, free));
  const window = { ...all, start: at(0), end: at(60) };
  assert.ok(!matchesChefFilter(chef("b"), window, () => true), "busy chefs are excluded");
  assert.ok(matchesChefFilter(chef("b"), { ...window, end: "" }, () => true), "a half-open window is ignored");
});
