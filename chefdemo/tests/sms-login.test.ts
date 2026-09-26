import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMobile } from "../src/lib/phone";
import { looksLikeAccessToken, verifyWidgetAccessToken, widgetSendOtp, widgetVerifyOtp } from "../src/lib/msg91";

test("mobile numbers normalize to MSG91's identifier form", () => {
  for (const input of ["9876543210", "+91 98765 43210", "098765-43210", "919876543210"])
    assert.equal(normalizeMobile(input), "919876543210", input);
  for (const input of ["", "12345", "5876543210", "+1 415 555 0100", "91987654321", null])
    assert.equal(normalizeMobile(input), null, String(input));
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (claims: unknown) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
const answer = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

test("MSG91 access tokens are re-verified server side and yield the attested mobile", async () => {
  assert.equal(looksLikeAccessToken("not a token"), false);
  assert.deepEqual(await verifyWidgetAccessToken("bad", { authKey: "k", fetchImpl: answer({}) }), { ok: false, reason: "malformed" });

  const t = token({ identifier: "919876543210" });
  assert.deepEqual(
    await verifyWidgetAccessToken(t, { authKey: "k", fetchImpl: answer({ type: "success", message: "919876543210" }) }),
    { ok: true, mobiles: ["919876543210"] },
  );
  assert.deepEqual(
    await verifyWidgetAccessToken(t, { authKey: "k", fetchImpl: answer({ type: "error", message: "AuthenticationFailure" }) }),
    { ok: false, reason: "rejected" },
    "a token MSG91 refuses is rejected even though its claims name a mobile",
  );
  assert.deepEqual(
    await verifyWidgetAccessToken(t, { authKey: "k", fetchImpl: answer({}, 503) }),
    { ok: false, reason: "unavailable" },
  );
});

test("MSG91 send and verify answers are classified", async () => {
  const widget = (body: unknown, status = 200) => ({ widgetId: "w", tokenAuth: "t", fetchImpl: answer(body, status) });
  assert.deepEqual(await widgetSendOtp(widget({ type: "success", message: "req-123456" }), "919876543210"), { ok: true, reqId: "req-123456" });
  assert.equal((await widgetSendOtp(widget({ type: "error", message: "Invalid Captcha Token" }), "919876543210")).ok, false);
  const limited = await widgetSendOtp(widget({ type: "error", message: "Max limit reached" }), "919876543210");
  assert.equal(!limited.ok && limited.reason, "throttled", "MSG91's own limits are rate limits, not failures");
  const down = await widgetSendOtp(widget({}, 502), "919876543210");
  assert.equal(!down.ok && down.reason, "unavailable");
  const t = token({ identifier: "919876543210" });
  assert.deepEqual(await widgetVerifyOtp(widget({ type: "success", message: t }), "req-123456", "123456"), { ok: true, accessToken: t });
  const wrong = await widgetVerifyOtp(widget({ type: "error", message: "OTP not match" }), "req-123456", "000000");
  assert.equal(!wrong.ok && wrong.reason, "rejected", "a wrong code is refused");
});
