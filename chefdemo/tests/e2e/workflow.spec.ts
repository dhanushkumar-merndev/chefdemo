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
