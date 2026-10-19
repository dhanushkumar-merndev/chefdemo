import { test, expect, type Page } from "@playwright/test";

/** A datetime-local value in IST, `hours` from now. */
const istInput = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000 + 5.5 * 3_600_000)
    .toISOString()
    .slice(0, 16);
const sidebar = (page: Page, name: string | RegExp) =>
  page.locator(".sidebar").getByRole("button", { name });
/** Edits the demo workspace in browser storage, then reloads the app. */
const editStore = async (page: Page, edit: (data: DemoStore) => void) => {
  await page.evaluate((source) => {
    const data = JSON.parse(localStorage.getItem("chefflow-prototype-v1")!);
    new Function("data", source)(data);
    localStorage.setItem("chefflow-prototype-v1", JSON.stringify(data));
  }, `(${edit.toString()})(data)`);
  await page.reload();
};
type DemoStore = {
  orders: { id: string; code: string; customer: string; bid_deadline: string; created_at: string }[];
  profiles: { id: string; name: string; chef_type?: string }[];
};
const asAdmin = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
};
const asChef = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
};
const toast = (page: Page) => page.locator(".toast");
const postOrder = async (
  page: Page,
  o: { customer: string; region?: string; location?: string; deadline?: number; start?: number; budget?: string },
) => {
  await page.getByRole("button", { name: "Post order" }).first().click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Customer name").fill(o.customer);
  await form.getByLabel("Service", { exact: true }).fill("Test dinner");
  await form.getByLabel("Service region").selectOption(o.region ?? "Bengaluru");
  await form.getByLabel("Service location").fill(o.location ?? "Koramangala");
  await form.getByRole("option", { name: o.location ?? "Koramangala", exact: true }).click();
  await form.getByLabel("Bidding closes (IST)").fill(istInput(o.deadline ?? 24));
  await form.getByLabel("Scheduled in (IST)").fill(istInput(o.start ?? 96));
  await form.getByLabel("Scheduled out (IST)").fill(istInput((o.start ?? 96) + 3));
  if (o.budget) await form.getByLabel("Client budget (₹, optional)").fill(o.budget);
  await form.getByLabel("Kitchen address").fill("1 Test Street");
  await form.getByRole("button", { name: "Post order" }).click();
};
const switchTo = async (page: Page, role: "chef" | "admin") => {
  await page.getByRole("button", { name: `Switch to ${role}` }).click();
  await expect(
    role === "chef"
      ? page.getByRole("heading", { name: "Hello, Arjun" })
      : page.getByRole("heading", { name: "Business overview" }),
  ).toBeVisible();
};

test("staff post an order, chefs bid, the cheapest wins and the deposit assigns the chef", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();

  // Post an order.
  await page.getByRole("button", { name: "Post order" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Customer name").fill("Sanya Kapoor");
  await form.getByLabel("Service", { exact: true }).fill("Anniversary dinner");
  await form.getByLabel("Service region").selectOption("Bengaluru");
  await form.getByLabel("Service location").fill("Koramangala");
  await form.getByRole("option", { name: "Koramangala", exact: true }).click();
  await form.getByLabel("Bidding closes (IST)").fill(istInput(24));
  await form.getByLabel("Scheduled in (IST)").fill(istInput(72));
  await form.getByLabel("Scheduled out (IST)").fill(istInput(75));
  await form.getByLabel("Client budget (₹, optional)").fill("6000");
  await form.getByLabel("Kitchen address").fill("42 Private Road, Koramangala");
  await form.getByRole("button", { name: "Post order" }).click();
  await expect(page.getByRole("status")).toContainText("Order posted");

  // The chef sees it on the dashboard and bids; the address stays hidden.
  await switchTo(page, "chef");
  await expect(page.getByRole("button", { name: /OR-1004 · Anniversary dinner/ })).toBeVisible();
  await sidebar(page, /Orders & bids/).click();
  await page.getByRole("button", { name: /Sanya Kapoor/ }).click();
  await expect(page.getByText("Shared with the chef who wins")).toBeVisible();
  const price = page.getByLabel("Your price for this service (₹)");
  await price.fill("6500");
  // Over the ₹6,000 budget: the form refuses it (the server rejects it too).
  expect(await price.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true);
  await price.fill("4200");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByRole("status")).toContainText("Bid placed");
  // Undercut Meera's ₹3,600 on Kavya Rao's order.
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByLabel("Your price for this service (₹)").fill("3400");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByRole("status")).toContainText("Bid placed");
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toContainText("₹3,400");

  // Staff close bidding: the cheapest bid wins and a deposit alert appears.
  await switchTo(page, "admin");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  const bids = page.locator(".bid-list li");
  await expect(bids).toHaveCount(2);
  await expect(bids.first()).toContainText("Arjun Kapoor");
  await expect(bids.first()).toContainText("₹3,400");
  await page.getByRole("button", { name: "Close bidding now" }).click();
  await expect(page.getByRole("status")).toContainText("Bidding closed");
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("button", { name: /Deposit due · OR-1001/ }).click();
  await expect(page.getByText("Client deposit (20%) · due now")).toBeVisible();
  await expect(page.locator(".deposit-box")).toContainText("₹680");
  await expect(page.locator(".deposit-box")).toContainText("₹2,720");
  await page.getByRole("button", { name: "Record 20% deposit (simulated)" }).click();
  await expect(page.getByRole("status")).toContainText("Deposit recorded · Arjun Kapoor assigned");

  // Confirmed: the booking exists, assigned to Arjun, with deposit and balance.
  await page.getByRole("tab", { name: "Confirmed" }).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByRole("button", { name: "Open booking" }).click();
  await expect(page.getByText("Client deposit paid (20%)")).toBeVisible();
  await expect(page.locator(".settlement")).toContainText("₹2,720");

  // The chef sees the upcoming booking, and it survives a reload.
  await switchTo(page, "chef");
  await page.reload();
  await sidebar(page, /^Bookings/).click();
  const booked = page.getByRole("button", { name: /Kavya Rao/ });
  await expect(booked).toContainText("Upcoming");
  await expect(booked).toContainText("₹3,400");
  await booked.click();
  await expect(page.getByText("Koramangala, Bengaluru").first()).toBeVisible();
  await expect(page.getByText("Balance due from client")).toBeVisible();
  await page.screenshot({ path: "test-results/bidding-assigned.png", fullPage: true });
});

test("staff find chefs by location, type, experience and availability", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await sidebar(page, "Find chefs").click();
  await expect(page.getByText("5 chefs found")).toBeVisible();

  await page.getByLabel("Region").selectOption("Bengaluru");
  await page.getByLabel("Serves location").fill("Whitefield");
  await page.getByRole("option", { name: "Whitefield", exact: true }).click();
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.getByText("2 chefs found")).toBeVisible();
  await expect(page.locator(".chef-result")).toContainText(["Kabir Singh", "Meera Iyer"]);

  await page.getByLabel("Minimum experience (years)").fill("10");
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.getByText("1 chef found")).toBeVisible();
  await expect(page.locator(".chef-result")).toContainText(["Kabir Singh"]);

  await page.getByLabel("Online now only").check();
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.getByText("0 chefs found")).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Chef type").selectOption("caterer");
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.locator(".chef-result")).toContainText(["Farah Khan"]);

  // Meera serves Indiranagar, but her award on Aditya Menon's order (72–75 h
  // from now, awaiting deposit) holds her for that time.
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Region").selectOption("Bengaluru");
  await page.getByLabel("Serves location").fill("Indiranagar");
  await page.getByRole("option", { name: "Indiranagar", exact: true }).click();
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.locator(".chef-result")).toContainText(["Meera Iyer"]);
  await page.getByLabel("Available from (IST)").fill(istInput(72.5));
  await page.getByLabel("Available until (IST)").fill(istInput(73));
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.getByText("0 chefs found · free for the whole time window")).toBeVisible();
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("tab", { name: "Awaiting deposit" }).click();
  await page.getByRole("button", { name: /Aditya Menon/ }).click();
  await expect(page.locator(".bid-list li.winner")).toContainText("Meera Iyer");
});

test("orders and chef search fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.getByRole("button", { name: "Open admin panel" }).click();
  const fits = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Orders" }).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await expect(page.locator(".bid-list li")).toHaveCount(1);
  await fits();
  await page.getByRole("button", { name: "Post order" }).click();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Find chefs", exact: true }).click();
  await expect(page.locator(".chef-result").first()).toBeVisible();
  await fits();
  await page.getByRole("button", { name: "Switch to chef" }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Orders" }).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await expect(page.getByRole("button", { name: "Place bid" })).toBeVisible();
  await fits();
});

test("posting an order checks the bidding deadline and is staff-only", async ({ page }) => {
  await asAdmin(page);
  // Deadline after the service starts: refused, the form stays open.
  await postOrder(page, { customer: "Late Deadline", deadline: 100, start: 96 });
  await expect(toast(page)).toContainText("bidding deadline must be in the future and before the service starts");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  // Chefs get neither the Post order button nor chef search.
  await switchTo(page, "chef");
  await sidebar(page, /Orders & bids/).click();
  await expect(page.getByRole("heading", { name: "Orders & bids" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post order" })).toHaveCount(0);
  await expect(sidebar(page, "Find chefs")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveText(["Open near you", "Awaiting deposit", "Confirmed", "All my orders"]);
});

test("chefs only see open orders in the area they serve", async ({ page }) => {
  await asAdmin(page);
  await postOrder(page, { customer: "Mumbai Client", region: "Mumbai", location: "Bandra" });
  await expect(toast(page)).toContainText("Order posted");
  await postOrder(page, { customer: "Koramangala Client" });
  await expect(toast(page)).toContainText("Order posted");
  await sidebar(page, /Orders & bidding/).click();
  await expect(page.getByRole("button", { name: /Mumbai Client/ })).toBeVisible();
  await switchTo(page, "chef");
  await expect(page.getByText("2 open near you · lowest bid wins")).toBeVisible();
  await sidebar(page, /Orders & bids/).click();
  await expect(page.getByRole("button", { name: /Koramangala Client/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mumbai Client/ })).toHaveCount(0);
});

test("a chef places, updates and withdraws a sealed bid", async ({ page }) => {
  await asChef(page);
  await sidebar(page, /Orders & bids/).click();
  const row = page.getByRole("button", { name: /Kavya Rao/ });
  // Sealed: the chef sees the client budget, not Meera's ₹3,600.
  await expect(row).toContainText("₹5,000");
  await expect(row).toContainText("Client budget");
  await expect(row).not.toContainText("₹3,600");
  await row.click();
  await expect(page.getByText("Shared with the chef who wins")).toBeVisible();
  await page.getByLabel("Your price for this service (₹)").fill("4000");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(toast(page)).toContainText("Bid placed");
  await expect(row).toContainText("Your bid");
  await expect(row).toContainText("Bid placed");
  await expect(page.getByLabel("Your price for this service (₹)")).toHaveValue("4000");
  await page.getByLabel("Your price for this service (₹)").fill("3900");
  await page.getByLabel("Note to the team (optional)").fill("Can bring my own tandoor");
  await page.getByRole("button", { name: "Update bid" }).click();
  await expect(toast(page)).toContainText("Bid updated");
  await expect(row).toContainText("₹3,900");
  // Staff see both bids, cheapest first, with the chef's note.
  await switchTo(page, "admin");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await expect(page.locator(".bid-list li").first()).toContainText("Meera Iyer");
  await expect(page.locator(".bid-list li").nth(1)).toContainText("“Can bring my own tandoor”");
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toContainText("2 bids");
  // Withdraw: the bid stops counting.
  await switchTo(page, "chef");
  await sidebar(page, /Orders & bids/).click();
  await row.click();
  await page.getByRole("button", { name: "Withdraw bid" }).click();
  await expect(toast(page)).toContainText("Bid withdrawn");
  await expect(row).toContainText("Withdrawn");
  await expect(page.getByRole("button", { name: "Place bid" })).toBeVisible();
  await switchTo(page, "admin");
  await sidebar(page, /Orders & bidding/).click();
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toContainText("1 bid");
});

test("equal bids go to whoever bid first, and the other chef is told", async ({ page }) => {
  await asChef(page);
  await sidebar(page, /Orders & bids/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByLabel("Your price for this service (₹)").fill("3600"); // same as Meera, later
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(toast(page)).toContainText("Bid placed");
  await switchTo(page, "admin");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByRole("button", { name: "Close bidding now" }).click();
  await expect(toast(page)).toContainText("Bidding closed");
  await page.getByRole("tab", { name: "Awaiting deposit" }).click();
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toContainText("Won by Meera Iyer");
  await switchTo(page, "chef");
  await sidebar(page, /Orders & bids/).click();
  await page.getByRole("tab", { name: "All my orders" }).click();
  const row = page.getByRole("button", { name: /Kavya Rao/ });
  await expect(row).toContainText("Not selected");
  await row.click();
  await expect(page.getByText("Another chef was selected for this order.")).toBeVisible();
  await expect(page.getByText("Shared with the chef who wins")).toBeVisible();
});

test("the winning chef is notified and sees the address before the deposit", async ({ page }) => {
  await asChef(page);
  await sidebar(page, /Orders & bids/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByLabel("Your price for this service (₹)").fill("3000");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(toast(page)).toContainText("Bid placed");
  await switchTo(page, "admin");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByRole("button", { name: "Close bidding now" }).click();
  await expect(toast(page)).toContainText("Bidding closed");
  await switchTo(page, "chef");
  // Dashboard card and bell both announce the win.
  await expect(page.getByRole("button", { name: /You won OR-1001/ })).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.locator(".flow-notifications").getByRole("button", { name: /You won OR-1001/ }).click();
  await expect(page.getByRole("tab", { name: "Awaiting deposit" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("You won this order at ₹3,000.")).toBeVisible();
  await expect(page.locator(".order-detail")).toContainText("Koramangala, Bengaluru");
  await expect(sidebar(page, /Orders & bids/)).toContainText("1");
});

test("bidding settles by itself once the deadline passes", async ({ page }) => {
  await asAdmin(page);
  await editStore(page, (data) => {
    data.orders.find((o) => o.code === "OR-1001")!.bid_deadline = new Date(Date.now() - 60_000).toISOString();
  });
  await sidebar(page, /Orders & bidding/).click();
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Awaiting deposit" }).click();
  await expect(page.getByRole("button", { name: /Kavya Rao/ })).toContainText("Won by Meera Iyer");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.locator(".flow-notifications")).toContainText("Deposit due · OR-1001");
});

test("an order without bids is marked No bids, alerts staff and can be cancelled", async ({ page }) => {
  await asAdmin(page);
  await postOrder(page, { customer: "Lonely Order", region: "Mumbai", location: "Bandra" });
  await expect(toast(page)).toContainText("Order posted");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Lonely Order/ }).click();
  await expect(page.getByText("No bids yet.")).toBeVisible();
  await page.getByRole("button", { name: "Close bidding now" }).click();
  await expect(toast(page)).toContainText("Bidding closed");
  await page.getByRole("tab", { name: "No bids" }).click();
  await expect(page.getByRole("button", { name: /Lonely Order/ })).toContainText("No bids");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.locator(".flow-notifications")).toContainText("No bids · OR-1004");
  await page.locator(".flow-notifications").getByRole("button", { name: /No bids · OR-1004/ }).click();
  await page.getByRole("button", { name: "Cancel order OR-1004" }).click();
  await expect(toast(page)).toContainText("Order cancelled");
  await page.getByRole("tab", { name: "Cancelled" }).click();
  await expect(page.getByRole("button", { name: /Lonely Order/ })).toContainText("Cancelled");
  // An open order can be cancelled too; chefs then stop seeing it.
  await page.getByRole("tab", { name: "Open for bids" }).click();
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByRole("button", { name: "Cancel order OR-1001" }).click();
  await expect(toast(page)).toContainText("Order cancelled");
  await switchTo(page, "chef");
  await sidebar(page, /Orders & bids/).click();
  await expect(page.getByText("No orders here")).toBeVisible();
});

test("an awarded chef is held: no overlapping manual booking before the deposit", async ({ page }) => {
  await asAdmin(page);
  // Seed: Meera won Aditya Menon's order (72–75 h from now), deposit still due.
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Customer name").fill("Clash Test");
  await form.getByLabel("Service", { exact: true }).fill("Lunch");
  await form.getByLabel("Service region").selectOption("Bengaluru");
  await form.getByLabel("Service location").fill("Indiranagar");
  await form.getByRole("option", { name: "Indiranagar", exact: true }).click();
  // The picker shows each chef's type and experience.
  await expect(form.getByRole("radio", { name: /Arjun Kapoor/ })).toHaveAccessibleName(/Professional chef · 8 yrs/);
  await form.getByRole("radio", { name: /Meera Iyer/ }).check();
  await form.getByLabel("Scheduled in (IST)").fill(istInput(73));
  await form.getByLabel("Scheduled out (IST)").fill(istInput(74));
  await form.getByLabel("Kitchen address").fill("Indiranagar");
  await form.getByRole("button", { name: "Create booking" }).click();
  await expect(toast(page)).toContainText("This chef already has a booking during these timings");
});

test("a recorded deposit shows its reference, amount and balance", async ({ page }) => {
  await asAdmin(page);
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("tab", { name: "Confirmed" }).click();
  await page.getByRole("button", { name: /Rohan Mehta/ }).click();
  const box = page.locator(".deposit-box");
  await expect(box).toContainText("Client deposit (20%) · paid");
  await expect(box).toContainText("₹350");
  await expect(box).toContainText("₹1,400");
  await expect(box).toContainText("Simulated payment SIM-OR-1003 recorded");
  await expect(page.getByRole("button", { name: "Record 20% deposit (simulated)" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Cancel order/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open booking" }).click();
  await expect(page.locator(".settlement")).toContainText("Client deposit paid (20%)");
  await expect(page.locator(".settlement")).toContainText("₹1,400");
  // The assigned chef sees the same deposit on the booking.
  await switchTo(page, "chef");
  await sidebar(page, /Orders & bids/).click();
  await page.getByRole("tab", { name: "Confirmed" }).click();
  await page.getByRole("button", { name: /Rohan Mehta/ }).click();
  await expect(page.getByText("Deposit paid. This service is assigned to you at ₹1,750.")).toBeVisible();
  await page.getByRole("button", { name: "Open booking" }).click();
  await expect(page.getByText("Balance due from client")).toBeVisible();
});

test("order lists page through results", async ({ page }) => {
  await asAdmin(page);
  await editStore(page, (data) => {
    const base = data.orders.find((o) => o.code === "OR-1001")!;
    for (let i = 1; i <= 12; i++)
      data.orders.push({
        ...base,
        id: `70000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        code: `OR-${2000 + i}`,
        customer: `Bulk client ${i}`,
        created_at: new Date(Date.parse(base.created_at) - i * 60_000).toISOString(),
      });
  });
  await sidebar(page, /Orders & bidding/).click();
  await expect(page.locator(".order-row")).toHaveCount(10);
  await expect(page.locator(".pager")).toContainText("1–10 of 13");
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".pager")).toContainText("11–13 of 13");
  await expect(page.locator(".order-row")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Bulk client 12/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  // Switching tabs starts again from the first page.
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.locator(".pager")).toContainText("1–10 of 15");
});

test("chefs must choose a chef type, and can change it in Profile", async ({ page }) => {
  await asChef(page);
  await editStore(page, (data) => {
    data.profiles.find((p) => p.name === "Arjun Kapoor")!.chef_type = "";
  });
  await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & continue" })).toBeDisabled();
  await page.getByLabel("Chef type").selectOption("baker");
  await page.getByRole("button", { name: "Save & continue" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
  await sidebar(page, "Profile").click();
  await expect(page.getByLabel("Chef type")).toHaveValue("baker");
  await page.getByLabel("Chef type").selectOption("caterer");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page)).toContainText("Profile saved");
  await expect(page.locator(".profile-summary")).toContainText("Caterer");
  // Staff search finds the chef under the new type.
  await switchTo(page, "admin");
  await sidebar(page, "Find chefs").click();
  await page.getByLabel("Chef type").selectOption("caterer");
  await page.getByRole("button", { name: "Search chefs" }).click();
  await expect(page.getByText("2 chefs found")).toBeVisible();
  await expect(page.locator(".chef-result")).toContainText(["Farah Khan", "Arjun Kapoor"]);
});
