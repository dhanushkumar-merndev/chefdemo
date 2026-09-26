import { normalizeMobile } from "./phone";

// MSG91 OTP widget API, called only from our server: no MSG91 script loads in
// the browser (Brave Shields and ad blockers block it), and the widget token
// auth never reaches the browser. Requires captcha off in the widget settings;
// with captcha on MSG91 answers "Invalid Captcha Token". Every call answers
// HTTP 200 with {type: "success" | "error", message}.
//
// verifyOtp returns a JWT access token. The server re-checks it with the
// account authkey and takes the verified phone from MSG91's answer, so a code
// sent to one number can never sign in as another.

const BASE = "https://control.msg91.com/api/v5/widget";
const VERIFY_ENDPOINT = `${BASE}/verifyAccessToken`;
const TIMEOUT_MS = 8_000;
const MAX_TOKEN_LENGTH = 4_096;

type Answer = { type?: unknown; message?: unknown };
export type Msg91Result<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: "rejected" | "throttled" | "unavailable"; message: string };

// MSG91 answers type=error for its own limits (resends, attempts) too; those
// are rate limits, not wrong codes.
const LIMIT_MESSAGE = /limit|many|exceed|max/i;

async function call(path: string, tokenAuth: string, body: unknown, fetchImpl: typeof fetch): Promise<Answer | { failure: string }> {
  try {
    const response = await fetchImpl(`${BASE}/${path}`, {
      method: "POST",
      headers: { tokenAuth, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 429) return { failure: "throttled" };
    if (response.status >= 500) return { failure: `http ${response.status}` };
    const answer = (await response.json().catch(() => null)) as Answer | null;
    return answer && typeof answer === "object" ? answer : { failure: "bad json" };
  } catch {
    return { failure: "network" };
  }
}

function refused(answer: Answer | { failure: string }): { ok: false; reason: "rejected" | "throttled" | "unavailable"; message: string } {
  if ("failure" in answer)
    return { ok: false, reason: answer.failure === "throttled" ? "throttled" : "unavailable", message: answer.failure };
  const message = typeof answer.message === "string" ? answer.message.slice(0, 120) : "error";
  return { ok: false, reason: LIMIT_MESSAGE.test(message) ? "throttled" : "rejected", message };
}

export type WidgetConfig = { widgetId: string; tokenAuth: string; fetchImpl?: typeof fetch };

/** Sends a code to the mobile ("91XXXXXXXXXX"); resolves with MSG91's request id. */
export async function widgetSendOtp(config: WidgetConfig, mobile: string): Promise<Msg91Result<{ reqId: string }>> {
  const { widgetId, tokenAuth } = config;
  const answer = await call("sendOtp", tokenAuth, { widgetId, tokenAuth, identifier: mobile }, config.fetchImpl ?? fetch);
  if (!("failure" in answer) && answer.type === "success" && typeof answer.message === "string")
    return { ok: true, reqId: answer.message };
  return refused(answer);
}

/** Checks the code; resolves with MSG91's JWT access token. */
export async function widgetVerifyOtp(config: WidgetConfig, reqId: string, otp: string): Promise<Msg91Result<{ accessToken: string }>> {
  const { widgetId, tokenAuth } = config;
  const answer = await call("verifyOtp", tokenAuth, { widgetId, tokenAuth, reqId, otp }, config.fetchImpl ?? fetch);
  if (!("failure" in answer) && answer.type === "success" && typeof answer.message === "string" && answer.message.startsWith("eyJ"))
    return { ok: true, accessToken: answer.message };
  return refused(answer);
}

export type WidgetVerification =
  | { ok: true; mobiles: string[] }
  | { ok: false; reason: "malformed" | "rejected" | "unavailable" };

// JWT segments are normally base64url; tolerate standard base64 and padding.
export function looksLikeAccessToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length <= MAX_TOKEN_LENGTH &&
    /^[\w+/=-]+\.[\w+/=-]+\.[\w+/=-]+$/.test(token)
  );
}

export async function verifyWidgetAccessToken(
  token: string,
  config: { authKey: string; fetchImpl?: typeof fetch },
): Promise<WidgetVerification> {
  if (!looksLikeAccessToken(token)) return { ok: false, reason: "malformed" };
  const fetchImpl = config.fetchImpl ?? fetch;

  let body: { type?: unknown; message?: unknown } | null = null;
  try {
    const response = await fetchImpl(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ authkey: config.authKey, "access-token": token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 429 || response.status >= 500) return { ok: false, reason: "unavailable" };
    body = await response.json().catch(() => null);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!body || body.type !== "success") return { ok: false, reason: "rejected" };

  // The token is authentic once MSG91 accepts it, so its claims can be read.
  const candidates = [...collectStrings(body.message), ...collectStrings(decodeJwtPayload(token))];
  return { ok: true, mobiles: [...new Set(candidates.flatMap(mobilesIn))] };
}

/** Indian mobiles found in a string ("919876543210", "+919876543210",
 *  "9876543210", or embedded in longer text), canonical form. */
function mobilesIn(value: string): string[] {
  return [...value.matchAll(/\+?\d{10,12}/g)]
    .map((m) => normalizeMobile(m[0]))
    .filter((m): m is string => m !== null);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]!;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** String and integer values anywhere in a small JSON value (depth ≤ 6). */
function collectStrings(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" && Number.isSafeInteger(value)) return [String(value)];
  if (depth >= 6 || !value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((v) => collectStrings(v, depth + 1));
}
