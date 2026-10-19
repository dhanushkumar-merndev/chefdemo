import { test, expect, type Page } from "@playwright/test";

/** A datetime-local value in IST, `hours` from now. */
const istInput = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000 + 5.5 * 3_600_000)
    .toISOString()
    .slice(0, 16);
const sidebar = (page: Page, name: string | RegExp) =>
  page.locator(".sidebar").getByRole("button", { name });
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
