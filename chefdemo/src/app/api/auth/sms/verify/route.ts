import { createHash } from "node:crypto";
import { verifyWidgetAccessToken, widgetVerifyOtp } from "@/lib/msg91";
import { normalizeMobile } from "@/lib/phone";
import {
  AMBIGUOUS,
  LIMITS,
  NO_ACCOUNT,
  UNAVAILABLE,
  accountFor,
  clientIp,
  USED_ELSEWHERE,
  createPhoneAccount,
  fail,
  sessionUserId,
  smsConfig,
  withinLimits,
} from "@/lib/sms-login";

// Checks a code with MSG91. For sign-in it returns a one-time Supabase login
// token hash that the browser exchanges with verifyOtp; with a name and no
// existing account it first creates the member (pending admin approval). For
// intent "link" it verifies the mobile on the signed-in member's account
// instead, so they can sign in with it too. MSG91 must
// attest the same mobile the browser claims (the request id alone is not
// trusted), each MSG91 token opens one session, and the mobile must belong to
// exactly one member. A member's email password is never read or changed.

const EXPIRED = "The code is invalid or has expired. Please request a new one.";

export async function POST(request: Request) {
  const config = smsConfig();
  if (!config) return fail(503, UNAVAILABLE);
  const { admin, widget, authKey } = config;

  const input = (await request.json().catch(() => null)) as { phone?: unknown; reqId?: unknown; code?: unknown; name?: unknown; intent?: unknown } | null;
  const mobile = normalizeMobile(input?.phone);
  if (!mobile) return fail(400, "Enter a valid 10-digit mobile number.");
  const code = typeof input?.code === "string" ? input.code.trim() : "";
  if (!/^\d{4,8}$/.test(code)) return fail(400, "Enter the code from the SMS.");
  const reqId = input?.reqId;
  if (typeof reqId !== "string" || !/^[\w-]{6,100}$/.test(reqId)) return fail(400, EXPIRED);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name.length > 120) return fail(400, "Enter a shorter name.");
  const linkTo = input?.intent === "link" ? await sessionUserId(admin, request) : null;
  if (input?.intent === "link" && !linkTo) return fail(401, "Please sign in again.");

  try {
    if (!(await withinLimits(admin, `verify:ip:${clientIp(request)}`, LIMITS.verifyIp)) ||
        !(await withinLimits(admin, `verify:phone:${mobile}`, LIMITS.verifyPhone)))
      return fail(429, "Too many attempts. Please wait a few minutes and request a new code.");
  } catch (error) {
    console.error("sms-login: verify limits failed", error instanceof Error ? error.message : error);
    return fail(503, UNAVAILABLE);
  }

  const checked = await widgetVerifyOtp(widget, reqId, code);
  if (!checked.ok) {
    console.warn("sms-login: verify refused", checked.reason, checked.message);
    if (checked.reason === "throttled") return fail(429, "Too many attempts. Please request a new code.");
    if (checked.reason === "unavailable") return fail(503, "The OTP service is not responding. Please try again.");
    return fail(401, "Incorrect code. Please check the SMS and try again.");
  }

  const verdict = await verifyWidgetAccessToken(checked.accessToken, { authKey });
  if (!verdict.ok) {
    console.warn("sms-login: token refused", verdict.reason);
    return verdict.reason === "unavailable" ? fail(503, "The OTP service is not responding. Please try again.") : fail(401, EXPIRED);
  }
  if (!verdict.mobiles.includes(mobile)) {
    console.warn("sms-login: attested mobile does not match", verdict.mobiles.length);
    return fail(401, EXPIRED);
  }

  try {
    const tokenHash = createHash("sha256").update(checked.accessToken).digest("hex");
    const { data: fresh, error: claimError } = await admin.rpc("claim_sms_login", { p_token_hash: tokenHash });
    if (claimError) throw new Error(`claim_sms_login: ${claimError.message}`);
    if (fresh !== true) return fail(401, EXPIRED);

    if (linkTo) {
      const { error: linkError } = await admin.rpc("set_verified_mobile", { p_id: linkTo, p_phone: `+${mobile}` });
      if (linkError?.message.includes("already used")) return fail(409, USED_ELSEWHERE);
      if (linkError) throw new Error(`set_verified_mobile: ${linkError.message}`);
      return Response.json({ verified: `+${mobile}` });
    }

    const account = await accountFor(admin, mobile);
    if (account === "ambiguous") return fail(409, AMBIGUOUS);
    if (account === "none" && !name) return fail(404, NO_ACCOUNT);
    // An existing member who used the sign-up form is simply signed in.
    const email = account === "none" ? await createPhoneAccount(admin, mobile, name) : account.email;

    // Admin link generation sends no email; it only mints a one-time token.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || !link.properties?.hashed_token) throw new Error(`generateLink: ${linkError?.message}`);
    return Response.json({ tokenHash: link.properties.hashed_token });
  } catch (error) {
    console.error("sms-login: sign-in failed", error instanceof Error ? error.message : error);
    return fail(503, UNAVAILABLE);
  }
}
