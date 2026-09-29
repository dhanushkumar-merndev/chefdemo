import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { LocationError, readLocationToken, searchLocations } from "@/lib/geoapify";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
// Small per-instance burst limit; approved-member authentication also protects quota.
const hits = new Map<string, { count: number; until: number }>();
function limit(id: string) {
  const now = Date.now();
  for (const [key, item] of hits) if (item.until <= now) hits.delete(key);
  const item = hits.get(id) ?? { count: 0, until: now + 60_000 };
  if (item.count >= 30 || (!hits.has(id) && hits.size >= 1000)) throw new LocationError("Too many location searches. Please wait a minute.", 429);
  item.count++;
  hits.set(id, item);
}

async function context(request: Request) {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new LocationError("Location search is unavailable. Choose a saved location or try again.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // The same no-Supabase mode as the browser repository. Never writes remote data.
  if (!url || !publicKey) { limit("demo"); return { key, admin: null }; }
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new LocationError("Location search is unavailable. Choose a saved location or try again.");
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new LocationError("Please sign in to search locations.", 401);
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) throw new LocationError("Please sign in again.", 401);
  const { data: profile, error } = await admin.from("profiles").select("role,approval_status").eq("id", auth.user.id).single();
  if (error || !profile || profile.approval_status !== "approved" || !["chef", "manager", "admin"].includes(profile.role)) throw new LocationError("An approved account is required.", 403);
  limit(auth.user.id);
  return { key, admin };
}

function failure(error: unknown) {
  return error instanceof LocationError ? json({ error: error.message }, error.status) : json({ error: "Location search is unavailable. Choose a saved location or try again." }, 503);
}

export async function GET(request: Request) {
  try {
    const { key } = await context(request);
    const params = new URL(request.url).searchParams;
    return json({ suggestions: await searchLocations(params.get("region") ?? "", params.get("q") ?? "", key) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { key, admin } = await context(request);
    const body = await request.json().catch(() => null);
    const selected = readLocationToken(body?.token, key);
    if (!selected) throw new LocationError("This suggestion expired. Search and select the location again.", 400);
    if (!admin) return json({ area: { id: randomUUID(), ...selected, active: true } });
    // Ignore duplicates: a disabled area must never be silently re-enabled.
    const { error } = await admin.from("service_areas").upsert(selected, { onConflict: "region,name", ignoreDuplicates: true });
    if (error) throw new LocationError("Could not save this location. Please try again.");
    const { data: area, error: readError } = await admin.from("service_areas").select("id,region,name,active").eq("region", selected.region).eq("name", selected.name).single();
    if (readError || !area) throw new LocationError("Could not save this location. Please try again.");
    if (!area.active) throw new LocationError("This location is currently unavailable for service.", 409);
    return json({ area });
  } catch (error) { return failure(error); }
}
