import { widgetSendOtp } from "@/lib/msg91";
import { normalizeMobile } from "@/lib/phone";
import {
  ALREADY_REGISTERED,
  AMBIGUOUS,
  LIMITS,
  NO_ACCOUNT,
  RESEND_AFTER_SECONDS,
  UNAVAILABLE,
  USED_ELSEWHERE,
  accountFor,
  clientIp,
  fail,
  sessionUserId,
  smsConfig,
  withinLimits,
} from "@/lib/sms-login";

// Sends a code for one of three intents:
//   login  — only to a mobile verified on a member's account;
//   signup — only to a mobile not verified on any account;
//   link   — a signed-in member verifying a mobile for their own account.
// Codes to numbers without an account (signup, link) share their own daily
// budget. Every send is limited per IP, per number and by a daily budget
// across all numbers.

export async function POST(request: Request) {
  const config = smsConfig();
  if (!config) return fail(503, UNAVAILABLE);
  const { admin, widget } = config;

  const input = (await request.json().catch(() => null)) as { phone?: unknown; intent?: unknown } | null;
  const mobile = normalizeMobile(input?.phone);
  if (!mobile) return fail(400, "Enter a valid 10-digit mobile number.");
  const intent = input?.intent === "signup" || input?.intent === "link" ? input.intent : "login";

  try {
    // IP first: it also limits probing which numbers have accounts.
    if (!(await withinLimits(admin, `send:ip:${clientIp(request)}`, LIMITS.sendIp)))
      return fail(429, "Too many OTP requests from this network. Please try again later.");
    const account = await accountFor(admin, mobile);
    if (account === "ambiguous") return fail(409, AMBIGUOUS);
    if (intent === "login" && account === "none") return fail(404, NO_ACCOUNT);
    if (intent === "signup" && account !== "none") return fail(409, ALREADY_REGISTERED);
    if (intent === "link") {
      const userId = await sessionUserId(admin, request);
      if (!userId) return fail(401, "Please sign in again.");
      if (account !== "none") return fail(409, account.id === userId ? "This mobile number is already verified on your account." : USED_ELSEWHERE);
    }
    if (!(await withinLimits(admin, `send:phone:${mobile}`, LIMITS.sendPhone)))
      return fail(429, "Too many OTP requests for this number. Please wait before trying again.");
    if (intent !== "login" && !(await withinLimits(admin, "send:new", LIMITS.sendNew))) {
      console.error("sms-login: daily new-number SMS budget reached");
      return fail(429, "Mobile verification is busy right now. Please try again tomorrow.");
    }
    if (!(await withinLimits(admin, "send:all", LIMITS.sendAll))) {
      console.error("sms-login: daily SMS budget reached");
      return fail(429, "SMS login is busy right now. Please sign in with email.");
    }
  } catch (error) {
    console.error("sms-login: send checks failed", error instanceof Error ? error.message : error);
    return fail(503, UNAVAILABLE);
  }

  const sent = await widgetSendOtp(widget, mobile);
  if (!sent.ok) {
    console.warn("sms-login: send refused", sent.reason, sent.message);
    if (sent.reason === "throttled") return fail(429, "Too many OTP requests for this number. Please wait before trying again.");
    return fail(503, "The OTP could not be sent. Please try again or sign in with email.");
  }
  return Response.json({ reqId: sent.reqId, resendAfter: RESEND_AFTER_SECONDS });
}
