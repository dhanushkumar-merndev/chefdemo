import { test, expect, type Page } from "@playwright/test";

// SMS sign-in, sign-up and Profile sign-in methods against the live-mode app.
// The browser's calls to /api/auth/sms/* and to Supabase are answered here,
// so no SMS is sent and no database is touched. Server-side checks (MSG91,
// rate limits, SQL) are covered by tests/sms-login.test.ts and
// tests/database.test.ts.

const SUPABASE = "http://127.0.0.1:54399";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

type Member = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  phone_verified: boolean;
  approval_status: "pending" | "approved";
};

/** Answers Supabase Auth and REST for one member; records what was sent. */
async function fakeSupabase(page: Page, member: Member) {
  const state = { member, newEmail: null as string | null, verifiedTokens: [] as string[], emailUpdates: [] as unknown[] };
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: member.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const user = () => ({
    id: member.id,
    aud: "authenticated",
    role: "authenticated",
    email: member.email ?? `phone-${member.id}@phone.invalid`,
    new_email: state.newEmail ?? undefined,
    app_metadata: {},
    user_metadata: { name: member.name },
    created_at: "2026-09-26T00:00:00Z",
  });
  const session = () => ({
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh",
    user: user(),
  });
  await page.route(`${SUPABASE}/auth/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.endsWith("/verify")) {
      state.verifiedTokens.push(request.postDataJSON().token_hash);
      return route.fulfill({ json: session(), headers: cors });
    }
    if (path.endsWith("/token")) return route.fulfill({ json: session(), headers: cors });
    if (path.endsWith("/user") && request.method() === "PUT") {
      const body = request.postDataJSON();
      state.emailUpdates.push(body);
      state.newEmail = body.email;
      return route.fulfill({ json: user(), headers: cors });
    }
    if (path.endsWith("/user")) return route.fulfill({ json: user(), headers: cors });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 404, json: {}, headers: cors });
  });
  await page.route(`${SUPABASE}/rest/v1/**`, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const table = new URL(route.request().url()).pathname.split("/").pop();
    const rows: Record<string, unknown[]> = {
      profiles: [{ role: "chef", cuisine: "", experience: 3, online: true, region: "Bengaluru", location: "Koramangala", ...state.member }],
      service_areas: [{ id: "a1", region: "Bengaluru", name: "Koramangala", active: true }],
    };
    return route.fulfill({ json: rows[table ?? ""] ?? [], headers: cors });
  });
  return { state, token };
}

type SmsReply = { status?: number; json: Record<string, unknown> };
/** Answers /api/auth/sms/send and /verify in order; records requests. */
async function fakeSmsApi(page: Page, replies: { send?: SmsReply[]; verify?: SmsReply[] }) {
  const calls = { send: [] as { body: Record<string, string>; auth: string | undefined }[], verify: [] as { body: Record<string, string>; auth: string | undefined }[] };
  for (const path of ["send", "verify"] as const) {
    await page.route(`**/api/auth/sms/${path}`, (route) => {
      calls[path].push({ body: route.request().postDataJSON(), auth: route.request().headers()["authorization"] });
      const list = replies[path] ?? [];
      const reply = list.length > 1 ? list.shift()! : list[0];
      return route.fulfill({ status: reply?.status ?? 200, json: reply?.json ?? {} });
    });
  }
  return calls;
}

const sent = { json: { reqId: "req-123456", resendAfter: 30 } };
const signedIn = { json: { tokenHash: "hash-from-server" } };
const otpBoxes = (page: Page) => page.locator(".otp-row input:not([type=hidden])");
const boxValues = (page: Page) => otpBoxes(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
const toast = (page: Page) => page.locator(".toast").last();
/** Types a code once the boxes are on screen, starting from the first box. */
async function typeCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").click();
  await page.keyboard.type(code);
}

async function openMobileTab(page: Page, signup = false) {
  await page.goto("/");
  if (signup) await page.getByRole("button", { name: "New staff member? Create account" }).click();
  await page.getByRole("tab", { name: "Mobile OTP" }).click();
}

const approvedMobileMember: Member = {
  id: "10000000-0000-4000-8000-00000000000a",
  name: "Dhanush Kumar",
  email: null,
  phone: "+919036215854",
  phone_verified: true,
  approval_status: "approved",
};

test("mobile OTP sign-in: validation, masked number, six boxes, typed code signs in", async ({ page }) => {
  const supabase = await fakeSupabase(page, approvedMobileMember);
  const api = await fakeSmsApi(page, { send: [sent], verify: [signedIn] });
  await openMobileTab(page);

  await page.getByPlaceholder("98765 43210").fill("12345");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(toast(page)).toContainText("valid 10-digit mobile number");
  expect(api.send).toHaveLength(0);

  await page.getByPlaceholder("98765 43210").fill("90362 15854");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(page.getByText("Enter the 6-digit code sent to +91 •••••• 5854")).toBeVisible();
  expect(api.send[0].body).toEqual({ phone: "919036215854", intent: "login" });
  expect(api.send[0].auth, "sign-in sends no session").toBeUndefined();
  await expect(otpBoxes(page)).toHaveCount(6);
  await expect(page.getByRole("button", { name: /Resend OTP in \d+s/ })).toBeDisabled();

  await typeCode(page, "123456");
  await expect(page.getByRole("heading", { name: /Hello, Dhanush/ })).toBeVisible();
  expect(api.verify[0].body).toEqual({ phone: "919036215854", reqId: "req-123456", code: "123456", intent: "login", name: "" });
  expect(supabase.state.verifiedTokens).toEqual(["hash-from-server"]);
  await page.screenshot({ path: "test-results/sms-signed-in.png" });
});

test("server refusals are shown and keep the member on the right step", async ({ page }) => {
  await fakeSupabase(page, approvedMobileMember);
  const api = await fakeSmsApi(page, {
    send: [
      { status: 404, json: { error: "No account uses this mobile number. Create an account, or sign in with email and verify your mobile under Profile." } },
      { status: 429, json: { error: "Too many OTP requests for this number. Please wait before trying again." } },
      sent,
    ],
    verify: [{ status: 401, json: { error: "Incorrect code. Please check the SMS and try again." } }],
  });
  await openMobileTab(page);
  const number = page.getByPlaceholder("98765 43210");
  await number.fill("9000000001");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(toast(page)).toContainText("No account uses this mobile number");
  await expect(number, "an unknown number stays on the number step").toBeVisible();

  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(toast(page)).toContainText("Too many OTP requests");

  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(otpBoxes(page)).toHaveCount(6);
  await typeCode(page, "000000");
  await expect(toast(page)).toContainText("Incorrect code");
  await expect(otpBoxes(page), "a wrong code keeps the code step").toHaveCount(6);
  expect(api.verify).toHaveLength(1);
});

test("OTP boxes: backspace, paste and autofill, resend after the countdown, change number", async ({ page }) => {
  await fakeSupabase(page, approvedMobileMember);
  const api = await fakeSmsApi(page, {
    send: [{ json: { reqId: "req-first", resendAfter: 2 } }, { json: { reqId: "req-second", resendAfter: 2 } }],
    verify: [{ status: 401, json: { error: "Incorrect code. Please check the SMS and try again." } }],
  });
  await openMobileTab(page);
  await page.getByPlaceholder("98765 43210").fill("9036215854");
  await page.getByRole("button", { name: "Send OTP" }).click();

  await typeCode(page, "1234");
  expect(await boxValues(page)).toEqual(["1", "2", "3", "4", "", ""]);
  await expect(page.getByLabel("Digit 5 of 6")).toBeFocused();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  expect(await boxValues(page)).toEqual(["1", "2", "", "", "", ""]);

  // Pasting (or the phone's SMS autofill) fills every box and submits.
  await page.getByLabel("Digit 1 of 6").focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "Your code is 987 654");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => api.verify.map((c) => c.body.code)).toEqual(["987654"]);
  expect(await boxValues(page)).toEqual(["9", "8", "7", "6", "5", "4"]);

  const resend = page.getByRole("button", { name: /Resend OTP/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toBeEnabled({ timeout: 5_000 });
  await resend.click();
  await expect(toast(page)).toContainText("OTP sent again to +91 •••••• 5854");
  expect(api.send.map((c) => c.body.phone)).toEqual(["919036215854", "919036215854"]);
  await expect(otpBoxes(page), "a new code starts with empty boxes").toHaveCount(6);
  expect(await boxValues(page)).toEqual(["", "", "", "", "", ""]);

  await page.getByRole("button", { name: "Change number" }).click();
  await expect(page.getByPlaceholder("98765 43210")).toBeVisible();
});

test("mobile sign-up: name never leaks into the OTP boxes, account awaits approval", async ({ page }) => {
  await fakeSupabase(page, { ...approvedMobileMember, name: "Dhanush", approval_status: "pending" });
  const api = await fakeSmsApi(page, { send: [sent], verify: [signedIn] });
  await openMobileTab(page, true);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Full name").fill("Dhanush");
  await page.getByPlaceholder("98765 43210").fill("9036215854");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await expect(otpBoxes(page)).toHaveCount(6);
  expect(await boxValues(page), "the name typed on the first step is not carried over").toEqual(["", "", "", "", "", ""]);
  expect(api.send[0].body).toEqual({ phone: "919036215854", intent: "signup" });

  await page.getByRole("button", { name: "Verify & create account" }).click();
  await expect(toast(page)).toContainText("Enter the 6-digit code");
  expect(api.verify, "an incomplete code is not sent").toHaveLength(0);

  await typeCode(page, "123456");
  await expect(page.getByRole("heading", { name: "Waiting for admin approval" })).toBeVisible();
  await expect(page.getByText("+919036215854")).toBeVisible();
  expect(api.verify[0].body).toMatchObject({ intent: "signup", name: "Dhanush", code: "123456" });
  await page.screenshot({ path: "test-results/sms-signup-pending.png" });
});

test("email member verifies a mobile in Profile and can then sign in with it", async ({ page }) => {
  const member: Member = { id: "10000000-0000-4000-8000-00000000000b", name: "Asha Rao", email: "asha@khanabanao.test", phone: "9876543210", phone_verified: false, approval_status: "approved" };
  const supabase = await fakeSupabase(page, member);
  const api = await fakeSmsApi(page, { send: [sent], verify: [{ json: { verified: "+919876543210" } }] });
  await page.route("**/api/auth/sms/verify", (route) => {
    // The server marks the mobile verified; the next profile load shows it.
    Object.assign(member, { phone: "+919876543210", phone_verified: true });
    return route.fallback();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("asha@khanabanao.test");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello, Asha/ })).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).first().click();

  const methods = page.locator(".signin-methods");
  await expect(methods).toContainText("Verify your mobile to also sign in with an OTP.");
  await expect(methods).toContainText("asha@khanabanao.test");
  await methods.getByRole("button", { name: "Verify mobile" }).click();
  await expect(methods.getByPlaceholder("98765 43210"), "the profile number is prefilled").toHaveValue("9876543210");
  await methods.getByRole("button", { name: "Send OTP" }).click();
  expect(api.send[0].body).toEqual({ phone: "919876543210", intent: "link" });
  expect(api.send[0].auth, "verifying a mobile sends the member's session").toBe(`Bearer ${supabase.token}`);

  await typeCode(page, "123456");
  await expect(methods).toContainText("+919876543210 · verified");
  expect(api.verify[0].body).toMatchObject({ intent: "link", code: "123456" });
  expect(api.verify[0].auth).toBe(`Bearer ${supabase.token}`);
  expect(supabase.state.verifiedTokens, "verifying a mobile does not start a new session").toEqual([]);
  await expect(methods.getByRole("button", { name: "Change" })).toBeVisible();
  await page.screenshot({ path: "test-results/sms-profile-verified.png", fullPage: true });
});

test("mobile member adds an email login; their mobile stays locked", async ({ page }) => {
  const supabase = await fakeSupabase(page, approvedMobileMember);
  await fakeSmsApi(page, { send: [sent], verify: [signedIn] });
  await openMobileTab(page);
  await page.getByPlaceholder("98765 43210").fill("9036215854");
  await page.getByRole("button", { name: "Send OTP" }).click();
  await typeCode(page, "123456");
  await expect(page.getByRole("heading", { name: /Hello, Dhanush/ })).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).first().click();

  await expect(page.getByLabel("Mobile number", { exact: true }), "a mobile-only member cannot edit their sign-in number").toHaveAttribute("readonly", "");
  const methods = page.locator(".signin-methods");
  await expect(methods).toContainText("+919036215854 · verified");
  await expect(methods).toContainText("Add an email to also sign in with a password.");

  await methods.getByLabel("Email").fill("Dhanush@Example.org");
  await methods.getByLabel("Password").fill("a-strong-password");
  await methods.getByRole("button", { name: "Add email login" }).click();
  await expect(methods).toContainText("Confirmation sent to dhanush@example.org");
  expect(supabase.state.emailUpdates).toHaveLength(1);
  expect(supabase.state.emailUpdates[0]).toMatchObject({ email: "dhanush@example.org", password: "a-strong-password" });
  await expect(page.getByText(/phone\.invalid/), "the internal address is never shown").toHaveCount(0);
});
