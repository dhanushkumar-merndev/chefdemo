import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Server-only helpers shared by /api/auth/sms/send and /api/auth/sms/verify.

export const RESEND_AFTER_SECONDS = 30;
const DAY = 86_400;

// [max hits, window seconds]. Short windows absorb honest retries; daily ones
// cap abuse. sendAll is the SMS budget across every number, per day;
// sendNew caps codes to numbers not yet verified on any account (sign-up and
// adding a mobile in Profile).
export const LIMITS = {
  sendPhone: [[1, RESEND_AFTER_SECONDS], [5, 3_600], [10, DAY]],
  sendIp: [[10, 3_600], [30, DAY]],
  sendAll: [[500, DAY]],
  sendNew: [[100, DAY]],
  verifyPhone: [[5, 900], [20, DAY]],
  verifyIp: [[30, 3_600]],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}
export const UNAVAILABLE = "SMS login is not available right now. Please sign in with email.";

export function smsConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const widgetId = process.env.MSG91_WIDGET_ID;
  const tokenAuth = process.env.MSG91_TOKEN_AUTH;
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!url || !secret || !widgetId || !tokenAuth || !authKey) {
    console.error("sms-login: set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, MSG91_WIDGET_ID, MSG91_TOKEN_AUTH and MSG91_AUTH_KEY");
    return null;
  }
  // The widget token cannot confirm access tokens; only the account authkey can.
  if (authKey === tokenAuth) {
    console.error("sms-login: MSG91_AUTH_KEY is the widget token auth; set the account authkey");
    return null;
  }
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return { admin, widget: { widgetId, tokenAuth }, authKey };
}
export type Admin = NonNullable<ReturnType<typeof smsConfig>>["admin"];

/** Vercel sets x-forwarded-for itself; its first entry is the client. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Counts one hit against every window for the key. False once any window is
 *  full; throws when the limiter itself is unavailable (fail closed). */
export async function withinLimits(admin: Admin, key: string, windows: readonly (readonly [number, number])[]) {
  for (const [limit, seconds] of windows) {
    const { data, error } = await admin.rpc("sms_rate_hit", { p_key: `${key}:${seconds}`, p_limit: limit, p_window_seconds: seconds });
    if (error) throw new Error(`sms_rate_hit: ${error.message}`);
    if (data !== true) return false;
  }
  return true;
}

/** The member who verified this mobile; "none" otherwise ("ambiguous" cannot
 *  happen while the unique index holds, but is refused rather than guessed). */
export async function accountFor(admin: Admin, mobile: string) {
  const { data, error } = await admin.rpc("sms_login_accounts", { p_phone: mobile });
  if (error) throw new Error(`sms_login_accounts: ${error.message}`);
  const rows = (data ?? []) as { id: string; email: string }[];
  if (rows.length === 0) return "none" as const;
  if (rows.length > 1) return "ambiguous" as const;
  return rows[0];
}

export const NO_ACCOUNT = "No account uses this mobile number. Create an account, or sign in with email and verify your mobile under Profile.";
export const ALREADY_REGISTERED = "This mobile number is already registered. Sign in with Mobile OTP instead.";
export const USED_ELSEWHERE = "This mobile number is already verified on another account.";

/** The signed-in member making the request (Authorization: Bearer <access token>). */
export async function sessionUserId(admin: Admin, request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
}

/** Creates a member who signs up by mobile and returns their Auth email.
 *  Supabase's phone provider is off, so the Auth user gets a random internal
 *  address that is only used to mint sign-in tokens (random, so nobody can
 *  pre-register it); mark_phone_account then makes the profile a phone account. */
export async function createPhoneAccount(admin: Admin, mobile: string, name: string): Promise<string> {
  const email = `phone-${randomUUID()}@phone.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const { error: markError } = await admin.rpc("mark_phone_account", { p_id: data.user.id, p_phone: `+${mobile}` });
  if (markError) {
    await admin.auth.admin.deleteUser(data.user.id);
    // Lost a race with a parallel sign-up for the same number.
    const again = await accountFor(admin, mobile);
    if (typeof again === "object") return again.email;
    throw new Error(`mark_phone_account: ${markError.message}`);
  }
  return email;
}
export const AMBIGUOUS = "This mobile number is on more than one account. Ask your administrator, or sign in with email.";
