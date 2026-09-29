import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../src/app/api/locations/route";

test("location endpoints authenticate members and register only signed, active service areas", async (t) => {
  const names = ["GEOAPIFY_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } });
  Object.assign(process.env, { GEOAPIFY_API_KEY: "geo-secret", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test", SUPABASE_SECRET_KEY: "server-secret" });
  let approval = "approved";
  let active = true;
  let registered = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "member-1" });
    if (url.pathname === "/rest/v1/profiles") return Response.json({ role: "chef", approval_status: approval });
    if (url.hostname === "api.geoapify.com") return Response.json({ results: [{ country_code: "in", city: "Chennai", state: "Tamil Nadu", suburb: "Velachery", result_type: "suburb" }] });
    if (url.pathname === "/rest/v1/service_areas") {
      if (init?.method === "POST") {
        const area = JSON.parse(String(init.body));
        assert.deepEqual(area, { region: "Chennai", name: "Velachery" });
        assert.match(String(new Headers(init.headers).get("prefer")), /resolution=ignore-duplicates/);
        registered = true;
        return new Response(null, { status: 201 });
      }
      return Response.json({ id: "saved-area", region: "Chennai", name: "Velachery", active });
    }
    throw new Error(`Unexpected service: ${url.pathname}`);
  });
  const search = (signedIn = true) => new Request("http://localhost/api/locations?region=Chennai&q=Velachery", { headers: signedIn ? { authorization: "Bearer member-token" } : {} });
  const select = (token: string) => new Request("http://localhost/api/locations", { method: "POST", headers: { authorization: "Bearer member-token", "content-type": "application/json" }, body: JSON.stringify({ token }) });
  assert.equal((await GET(search(false))).status, 401);
  approval = "pending";
  assert.equal((await GET(search())).status, 403);
  approval = "approved";
  assert.equal((await POST(select("fabricated"))).status, 400);
  assert.equal(registered, false);
  const answer = await GET(search());
  assert.equal(answer.status, 200);
  const text = await answer.text();
  assert.equal(text.includes("geo-secret"), false);
  const { suggestions } = JSON.parse(text);
  const response = await POST(select(suggestions[0].token));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { area: { id: "saved-area", region: "Chennai", name: "Velachery", active: true } });
  active = false;
  assert.equal((await POST(select(suggestions[0].token))).status, 409);
});
