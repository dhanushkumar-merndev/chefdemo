import { test, expect } from "@playwright/test";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const upload = { name: "kitchen.png", mimeType: "image/png", buffer: pixel };

test("chef saves dishes, sees overtime, uploads evidence and completes service with persistence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Arjun" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/chef-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Update service" }).click();
  await expect(page.getByText(/Scheduled out time exceeded by/)).toBeVisible();
  await page.getByRole("button", { name: "Check out & complete" }).click();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "all four kitchen photos",
  );
  await page.getByRole("checkbox", { name: /Masala dosa/ }).check();
  await page.getByRole("button", { name: "Save selected dishes" }).click();
  await expect(page.getByRole("button", { name: "Menu saved" })).toBeDisabled();
  for (const name of [
    "Entry photo",
    "Kitchen before",
    "Preparing food",
    "Kitchen after",
  ]) {
    await page.getByLabel(name, { exact: true }).setInputFiles(upload);
    await expect(page.getByRole("status").last()).toContainText(
      `${name} uploaded`,
    );
  }
  await expect(page.getByText("4/4 uploaded")).toBeVisible();
  await page.screenshot({
    path: "test-results/service-detail.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Check out & complete" }).click();
  await expect(page.getByText("Final service total")).toBeVisible();
  await expect(page.getByText("Service record locked")).toHaveCount(4);
  await page.reload();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^Bookings/ })
    .click();
  await page.getByRole("button", { name: /Imon Das/ }).click();
  await expect(page.getByText("Final service total")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Masala dosa/ }),
  ).toBeChecked();
});

test("admin creates staff, dishes and bookings and exports analytics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Business overview" }),
  ).toBeVisible();
  await expect(page.getByText("Here’s what your kitchen has on the menu today.")).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Review members (0 pending)"})).toBeVisible();
  await page.screenshot({
    path: "test-results/admin-dashboard.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Team & roles" })
    .click();
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await page.getByLabel("Full name").fill("Test Chef");
  await page.getByLabel("Email", { exact: true }).fill("test@chef.demo");
  await page
    .getByRole("button", { name: "Add staff member", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: "Test Chef" })).toBeVisible();
  const staffRow=page.getByRole("row").filter({has:page.getByRole("cell",{name:"Test Chef",exact:true})});
  await expect(staffRow).toContainText("pending");
  await staffRow.getByRole("button",{name:"Approve",exact:true}).click();
  await expect(staffRow).toContainText("approved");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Dish library" })
    .click();
  await page.getByRole("button", { name: "Add dish", exact: true }).click();
  await page.getByLabel("Dish name").fill("Lemon rice");
  await page.getByLabel("Cuisine", { exact: true }).fill("South Indian");
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByRole("heading", { name: "Lemon rice" })).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Manage bookings" })
    .click();
  await page
    .getByRole("button", { name: "Create booking", exact: true })
    .click();
  await page.getByLabel("Customer name").fill("Prototype Customer");
  await page.getByLabel("Service", { exact: true }).fill("Family lunch");
  await page.getByLabel("Service region").selectOption("Bengaluru");
  await page.getByLabel("Service location").selectOption("Koramangala");
  await page.getByRole("group", { name: "Assigned chef" }).getByRole("radio", { name: /Test Chef/ }).check();
  await page.getByLabel("Scheduled in (IST)").fill("2026-12-15T12:00");
  await page.getByLabel("Scheduled out (IST)").fill("2026-12-15T15:00");
  await page.getByLabel("Kitchen address").fill("Bengaluru");
  await page.getByLabel("Lemon rice", { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create booking" })
    .click();
  await expect(
    page.getByRole("button", { name: /Prototype Customer.*Family lunch/ }),
  ).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Business overview" })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT CSV" }).click();
  expect((await download).suggestedFilename()).toBe("chefflow-bookings.csv");
});

test("mobile navigation fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Arjun" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-dashboard.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Bookings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "My bookings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Riya Malhotra/ }).click();
  await expect(
    page.getByRole("heading", { name: "Chef timings" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

for (const width of [320, 390, 768, 1440]) {
  test(`admin pages and booking form fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/');
    await page.getByRole('button',{name:'Open admin panel'}).click();
    await expect(page.getByRole('heading',{name:'Business overview'})).toBeVisible();
    const fit=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await fit();
    await page.getByRole('button',{name:'Create booking',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const box=await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    await dialog.getByLabel('Service region').selectOption('Bengaluru');
    await dialog.getByLabel('Service location').selectOption('Koramangala');
    await expect(dialog.getByRole('radio',{name:/Arjun Kapoor/})).toBeVisible();
    await dialog.getByRole('radio',{name:/Arjun Kapoor/}).check();
    await dialog.getByRole('button',{name:'Close dialog'}).click();
    for(const name of ['Manage bookings','Service revenue','Dish library','Team & approvals','Calendar','Account profile','Support tickets']) {
      if(width<=670) {
        await page.getByRole('button',{name:'All pages'}).click();
        await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();
      } else {
        const label=name==='Team & approvals'?'Team & roles':name==='Account profile'?'Profile':name==='Support tickets'?'Support & help':name;
        if(name==='Calendar') { await page.locator('.sidebar').getByRole('button',{name:/Manage bookings/}).click();await page.getByRole('button',{name:'Calendar view'}).click(); }
        else await page.locator('.sidebar').getByRole('button',{name:label,exact:false}).click();
      }
      await fit();
    }
    await page.screenshot({path:`test-results/admin-responsive-${width}.png`,fullPage:true});
  });
}

test("booking form groups chefs by location and records the service area", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Team & roles" }).click();
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await page.getByLabel("Full name").fill("Chennai Chef");
  await page.getByLabel("Email", { exact: true }).fill("chennai@chef.demo");
  await page.getByRole("button", { name: "Add staff member", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Chennai Chef", exact: true }) });
  await row.getByRole("button", { name: "Approve", exact: true }).click();

  await page.locator(".sidebar").getByRole("button", { name: "Manage bookings" }).click();
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Select a region and location to see the chefs who work there.")).toBeVisible();
  await dialog.getByLabel("Service region").selectOption("Bengaluru");
  await dialog.getByLabel("Service location").selectOption("Koramangala");
  // Arjun Kapoor works in Koramangala, the new chef has no location yet.
  const options = dialog.locator(".chef-picker-options");
  await expect(options.getByText("In Koramangala")).toBeVisible();
  await expect(options.getByText("Other areas")).toBeVisible();
  const order = await options.locator("label b").allInnerTexts();
  expect(order[0]).toBe("Arjun Kapoor");
  await expect(options.locator("label").filter({ hasText: "Chennai Chef" })).toContainText("outside this area");

  await dialog.getByLabel("Customer name").fill("Area Customer");
  await dialog.getByLabel("Service", { exact: true }).fill("Location test dinner");
  await dialog.getByRole("radio", { name: /Arjun Kapoor/ }).check();
  await dialog.getByLabel("Scheduled in (IST)").fill("2027-02-11T12:00");
  await dialog.getByLabel("Scheduled out (IST)").fill("2027-02-11T15:00");
  await dialog.getByLabel("Kitchen address").fill("12 Test Road");
  await dialog.getByRole("button", { name: "Create booking" }).click();
  await expect(dialog).toBeHidden();
  const created = page.locator(".booking-row").filter({ hasText: "Area Customer" });
  await expect(created).toContainText("Koramangala, Bengaluru");
  await expect(created).toContainText(/CF-\d{4}/);
});

test("bookings can be searched by booking code, date, region and location", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Manage bookings" }).click();
  const rows = page.locator(".booking-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);

  const firstCode = (await rows.first().locator(".booking-code").innerText()).trim();
  await page.getByLabel("Search bookings").fill(firstCode);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(firstCode);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(total);

  await page.getByLabel("Filter by location").selectOption("Whitefield");
  const whitefield = await rows.count();
  expect(whitefield).toBeGreaterThan(0);
  for (const text of await rows.allInnerTexts()) expect(text).toContain("Whitefield");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Filter by region").selectOption("Chennai");
  await expect(page.getByText("No matching bookings")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  const day = (await rows.first().getAttribute("aria-label")) ?? "";
  await page.getByLabel("Filter by date").fill("2099-01-01");
  await expect(page.getByText("No matching bookings")).toBeVisible();
  expect(day).not.toBe(null);
});

test("a chef without a location must set one before using the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
  // Simulate a chef who registered before locations existed.
  await page.evaluate(() => {
    const key = "chefflow-prototype-v1";
    const data = JSON.parse(localStorage.getItem(key)!);
    for (const p of data.profiles) if (p.role === "chef") { p.region = ""; p.location = ""; }
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
  const save = page.getByRole("button", { name: "Save & continue" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Region you work in").selectOption("Bengaluru");
  await page.getByLabel("Location you work in").selectOption("Indiranagar");
  await save.click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Profile" }).click();
  await expect(page.getByLabel("Location you work in")).toHaveValue("Indiranagar");
});

for (const role of ["chef", "admin"] as const) {
  test(`every ${role} page fits a phone screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    // the dev-only Next.js overlay button floats over the bottom navigation
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page
      .getByRole("button", {
        name: role === "chef" ? "Explore chef dashboard" : "Open admin panel",
      })
      .click();
    const fits = async (label: string) => {
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => ({
        wide: document.documentElement.scrollWidth > window.innerWidth,
        // the fixed bottom navigation must never cover the last interactive element
        navTop:
          document
            .querySelector(".mobile-nav")
            ?.getBoundingClientRect().top ?? 0,
        height: window.innerHeight,
        body: document.body.innerText.length,
      }));
      expect(r.wide, `${label} scrolls sideways at 390px`).toBeFalsy();
      expect(r.navTop, `${label} has no bottom navigation`).toBeGreaterThan(0);
      expect(r.navTop, `${label} navigation sits off screen`).toBeLessThan(
        r.height,
      );
      expect(r.body, `${label} looks empty`).toBeGreaterThan(40);
      await expect(
        page.locator(".toast[role=alert]"),
        `${label} shows an error`,
      ).toHaveCount(0);
    };
    const bottom = page.getByRole("navigation", { name: "Mobile navigation" });
    for (const label of await bottom.locator("button").allInnerTexts()) {
      await bottom.getByRole("button", { name: label, exact: true }).click();
      await fits(`${role} bottom-nav ${label}`);
    }
    await page.getByRole("button", { name: "All pages" }).click();
    const dialog = page.getByRole("dialog");
    const pages = await dialog.locator(".all-pages button").allInnerTexts();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    for (const label of pages) {
      await page.getByRole("button", { name: "All pages" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: label, exact: true })
        .click();
      await fits(`${role} page ${label}`);
    }
    if (role === "admin") {
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("button", { name: "Bookings", exact: true })
        .click();
      await page.getByRole("button", { name: "Create booking", exact: true }).first().click();
      const form = page.getByRole("dialog");
      const box = await form.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      await form.getByLabel("Service region").selectOption("Bengaluru");
      await form.getByLabel("Service location").selectOption("Koramangala");
      await expect(form.getByText("In Koramangala")).toBeVisible();
      await fits("admin booking form");
      await form.getByRole("button", { name: "Close dialog" }).click();
    } else {
      await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Bookings" }).click();
      await page.getByLabel("Search bookings").fill("CF-");
      await fits("chef booking search");
      await page.locator(".booking-row").first().click();
      await expect(page.getByRole("heading", { name: "Chef timings" })).toBeVisible();
      await fits("chef service detail");
    }
    await page.screenshot({ path: `test-results/mobile-${role}.png`, fullPage: true });
  });
}

test("the browser back button retraces steps instead of leaving the app", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.getByRole("button", { name: "Explore chef dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();
  const bottom = page.getByRole("navigation", { name: "Mobile navigation" });

  await bottom.getByRole("button", { name: "Bookings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
  await bottom.getByRole("button", { name: "Earnings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Earnings", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Hello, Arjun" })).toBeVisible();

  // opening a booking, then back, returns to the list rather than closing the app
  await bottom.getByRole("button", { name: "Bookings", exact: true }).click();
  await page.locator(".booking-row").first().click();
  await expect(page.getByRole("heading", { name: "Chef timings" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chef timings" })).toHaveCount(0);

  // the full-screen menu closes on back too
  await page.getByRole("button", { name: "All pages" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
});

test("admin tables stack into readable cards on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.getByRole("button", { name: "Open admin panel" }).click();
  await page.getByRole("button", { name: "All pages" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Team & approvals", exact: true }).click();
  const table = page.locator(".table-card table").first();
  await expect(table).toBeVisible();
  const layout = await table.evaluate((el) => {
    const row = el.querySelector("tbody tr");
    const cell = row?.querySelector("td");
    const approve = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Approve");
    return {
      headerHidden: getComputedStyle(el.querySelector("thead")!).display === "none",
      labelled: !!cell?.getAttribute("data-label"),
      rowWidth: row!.getBoundingClientRect().width,
      // a wrapped "Approve" label would be far taller than one line
      approveHeight: approve ? approve.getBoundingClientRect().height : 0,
      approveWidth: approve ? approve.getBoundingClientRect().width : 0,
      scrolls: el.scrollWidth > el.clientWidth + 1,
    };
  });
  expect(layout.headerHidden).toBeTruthy();
  expect(layout.labelled).toBeTruthy();
  expect(layout.scrolls, "table should not scroll sideways on a phone").toBeFalsy();
  expect(layout.rowWidth).toBeLessThanOrEqual(390);
  if (layout.approveHeight) {
    expect(layout.approveHeight, "Approve label wraps onto several lines").toBeLessThan(48);
    expect(layout.approveWidth).toBeGreaterThan(54);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile-team-cards.png", fullPage: true });
});
