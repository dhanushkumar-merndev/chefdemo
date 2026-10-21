import { test, expect, type Page } from "@playwright/test";

const asAdmin = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
};

test("a form stays open when a click lands in its margin or a drag ends outside a field", async ({ page }) => {
  await asAdmin(page);
  await page.getByRole("button", { name: "Post order" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Service region").selectOption("Bengaluru");
  await dialog.getByLabel("Service location").fill("Koramangala");
  await dialog.getByRole("option", { name: "Koramangala", exact: true }).click();
  const guests = dialog.getByLabel("Guests");
  const box = (await guests.boundingBox())!;
  const frame = (await dialog.boundingBox())!;
  // The white margin to the left of "Guests", inside the form.
  await page.mouse.click(frame.x + 8, box.y + box.height / 2);
  await expect(dialog, "clicking the form's margin closed it").toBeVisible();
  // Select the guest count by dragging, releasing over the margin.
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + 6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(dialog, "a drag that ended in the margin closed it").toBeVisible();
  await guests.fill("12");
  await expect(guests).toHaveValue("12");
  // A real click on the dimmed backdrop still closes it.
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

const asChef = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
};
const sidebar = (page: Page, name: string | RegExp) => page.locator(".sidebar").getByRole("button", { name });
const toast = (page: Page) => page.locator(".toast");
/** A datetime-local value in IST, `hours` from now. */
const istInput = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000 + 5.5 * 3_600_000).toISOString().slice(0, 16);
const switchTo = async (page: Page, role: "chef" | "admin") => {
  await page.getByRole("button", { name: `Switch to ${role}` }).click();
  await expect(
    page.getByRole("heading", { name: role === "chef" ? "Hello, Arjun" : "Business overview" }),
  ).toBeVisible();
};

test("a chef sees every locality of their city and can narrow it by typing", async ({ page }) => {
  await asChef(page);
  await sidebar(page, "Profile").click();
  const field = page.getByLabel("Location you work in");
  await field.fill("");
  const list = page.getByRole("listbox", { name: "Location suggestions" });
  await expect(list.getByRole("option")).toHaveCount(50);
  await expect(list).toContainText(/Showing 50 of [7-9]\d\d — type to narrow the list/);
  await field.fill("ko");
  await expect(list.getByRole("option", { name: "Koramangala", exact: true })).toBeVisible();
  await field.fill("qz");
  await expect(page.getByText("Not in the list — keep typing (3+ letters) to search all of Bengaluru.")).toBeVisible();
  await field.fill("Marathahalli");
  await list.getByRole("option", { name: "Marathahalli", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page)).toContainText("Profile saved");
  await page.reload();
  await sidebar(page, "Profile").click();
  await expect(page.getByLabel("Location you work in")).toHaveValue("Marathahalli");
});

test("an admin edits a chef's details from Find chefs and from Team & roles", async ({ page }) => {
  await asAdmin(page);
  await sidebar(page, "Find chefs").click();
  await page.getByRole("button", { name: "Edit Meera Iyer" }).click();
  const form = page.getByRole("dialog", { name: "Edit Meera Iyer" });
  await expect(form.getByText("mobile and email are their sign-in methods")).toBeVisible();
  await form.getByLabel("Chef type").selectOption("baker");
  await form.getByLabel("Work experience (years)").fill("7");
  await form.getByLabel("Location they work in").fill("Whitefield");
  await form.getByRole("option", { name: "Whitefield", exact: true }).click();
  await form.getByRole("button", { name: "Save chef" }).click();
  await expect(toast(page)).toContainText("Meera Iyer updated");
  const card = page.locator(".chef-result", { hasText: "Meera Iyer" });
  await expect(card).toContainText("Baker · 7 yrs experience");
  await expect(card).toContainText("Whitefield, Bengaluru");

  await sidebar(page, "Team & roles").click();
  await page.getByRole("button", { name: "Edit Kabir Singh" }).click();
  await page.getByRole("dialog").getByLabel("Full name").fill("Kabir S. Singh");
  await page.getByRole("dialog").getByLabel("Available (online) for new orders").check();
  await page.getByRole("dialog").getByRole("button", { name: "Save chef" }).click();
  await expect(toast(page)).toContainText("Kabir S. Singh updated");
  await expect(page.getByRole("row", { name: /Kabir S\. Singh/ })).toContainText("Online");
  // Staff rows have no chef editor.
  await expect(page.getByRole("button", { name: "Edit Priya Sharma" })).toHaveCount(0);
});

test("an admin edits an open order; terms chefs priced lock once they bid", async ({ page }) => {
  await asAdmin(page);
  await page.getByRole("button", { name: "Post order" }).first().click();
  const post = page.getByRole("dialog");
  await post.getByLabel("Customer name").fill("Pradeep Kumar");
  await post.getByLabel("Service", { exact: true }).fill("Test");
  await post.getByLabel("Service region").selectOption("Bengaluru");
  await post.getByLabel("Service location").fill("HSR Layout");
  await post.getByRole("option", { name: "HSR Layout", exact: true }).click();
  await post.getByLabel("Bidding closes (IST)").fill(istInput(24));
  await post.getByLabel("Scheduled in (IST)").fill(istInput(48));
  await post.getByLabel("Scheduled out (IST)").fill(istInput(54));
  await post.getByLabel("Kitchen address").fill("17-91-D-9, 2nd floor Nemali Nagar");
  await post.getByRole("button", { name: "Post order" }).click();
  await expect(toast(page)).toContainText("Order posted");

  // No bids yet: everything can change.
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: /Pradeep Kumar/ }).click();
  await page.getByRole("button", { name: "Edit order" }).click();
  const edit = page.getByRole("dialog", { name: "Edit order OR-1004" });
  await expect(edit.getByLabel("Customer name")).toHaveValue("Pradeep Kumar");
  await expect(edit.getByLabel("Kitchen address")).toHaveValue("17-91-D-9, 2nd floor Nemali Nagar");
  await edit.getByLabel("Guests").fill("25");
  await edit.getByLabel("Service location").fill("Koramangala");
  await edit.getByRole("option", { name: "Koramangala", exact: true }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page)).toContainText("Order OR-1004 updated");
  const row = page.getByRole("button", { name: /Pradeep Kumar/ });
  await expect(row).toContainText("25 guests");
  await expect(row).toContainText("Koramangala, Bengaluru");

  // Kavya Rao's order already has Meera's bid: only unpriced details change.
  await page.getByRole("button", { name: /Kavya Rao/ }).click();
  await page.getByRole("button", { name: "Edit order" }).click();
  const locked = page.getByRole("dialog", { name: "Edit order OR-1001" });
  await expect(locked.getByText("Chefs have already bid")).toBeVisible();
  await expect(locked.getByLabel("Guests")).toHaveAttribute("readonly", "");
  await expect(locked.getByLabel("Service location")).toHaveValue("Koramangala, Bengaluru");
  await locked.getByLabel("Customer name").fill("Kavya R. Rao");
  await locked.getByLabel("Customer notes").fill("Ring the bell twice");
  await locked.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page)).toContainText("Order OR-1001 updated");
  await expect(page.getByRole("button", { name: /Kavya R\. Rao/ })).toBeVisible();

  // Awarded and confirmed orders cannot be edited.
  await page.getByRole("tab", { name: "Awaiting deposit" }).click();
  await page.getByRole("button", { name: /Aditya Menon/ }).click();
  await expect(page.getByRole("button", { name: "Edit order" })).toHaveCount(0);
});

test("an admin adds, renames and turns off service locations", async ({ page }) => {
  await asAdmin(page);
  await sidebar(page, "Service locations").click();
  await expect(page.getByRole("heading", { name: "Service locations" })).toBeVisible();
  await expect(page.getByText(/\d{3} of \d{3} locations active in Bengaluru/)).toBeVisible();
  await expect(page.locator(".pager")).toContainText(/1–50 of \d{3}/);

  // Add a locality the download does not have.
  await page.getByLabel("New location in Bengaluru").fill("Electronic City Phase 1");
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(toast(page)).toContainText("Electronic City Phase 1 added to Bengaluru");
  await page.getByLabel("Search locations").fill("Electronic City");
  await expect(page.getByRole("row", { name: /Electronic City Phase 1/ })).toContainText("Active");

  // Rename: the demo chef working there moves with it.
  await page.getByLabel("Search locations").fill("Koramangala");
  await page.getByRole("button", { name: "Rename Koramangala", exact: true }).click();
  await page.getByRole("dialog").getByLabel("New name").fill("Koramangala Central");
  await page.getByRole("dialog").getByRole("button", { name: "Save name" }).click();
  await expect(toast(page)).toContainText("Renamed to Koramangala Central");
  // Built-in areas cannot be renamed.
  await page.getByLabel("Search locations").fill("All locations");
  await expect(page.getByRole("button", { name: "Rename All locations" })).toHaveCount(0);

  // Turn one off: it disappears from new choices.
  await page.getByLabel("Search locations").fill("Whitefield");
  await page.getByRole("button", { name: "Turn off Whitefield", exact: true }).click();
  await expect(toast(page)).toContainText("Whitefield turned off");
  await expect(page.getByRole("row", { name: /^Whitefield/ })).toContainText("Turned off");
  await sidebar(page, /Orders & bidding/).click();
  await page.getByRole("button", { name: "Post order" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Service region").selectOption("Bengaluru");
  await form.getByLabel("Service location").fill("Whitefield");
  await expect(form.getByRole("option", { name: "Whitefield", exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Close dialog" }).click();

  await switchTo(page, "chef");
  await sidebar(page, "Profile").click();
  await expect(page.getByLabel("Location you work in")).toHaveValue("Koramangala Central");
});
