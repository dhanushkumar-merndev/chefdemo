// Imported only by the server route. Neither the key nor provider URLs reach the browser.
import { createHmac, timingSafeEqual } from "node:crypto";
import { supportedRegions, type LocationSuggestion } from "./service-areas";

const UNAVAILABLE = "Location search is unavailable. Choose a saved location or try again.";
export class LocationError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

type Place = {
  country_code?: string; state?: string; state_code?: string; city?: string;
  county?: string; district?: string; suburb?: string; name?: string;
  address_line1?: string; formatted?: string; result_type?: string;
};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown) => clean(value).toLowerCase().replace(/ district$/, "");
const cities: Record<string, string[]> = {
  Bengaluru: ["bengaluru", "bangalore", "bengaluru urban", "bangalore urban"],
  Chennai: ["chennai"],
  Hyderabad: ["hyderabad", "secunderabad"],
  Mumbai: ["mumbai", "mumbai suburban"],
};
// NCRPB constituent areas: https://ncrpb.nic.in/ncrconstituent.html
// Include common provider spellings and cities where county is a subdistrict.
const ncr: Record<string, string[]> = {
  haryana: ["faridabad", "gurugram", "gurgaon", "nuh", "mewat", "rohtak", "sonepat", "sonipat", "rewari", "jhajjhar", "jhajjar", "panipat", "palwal", "bhiwani", "charkhi dadri", "mahendragarh", "jind", "karnal"],
  "uttar pradesh": ["meerut", "ghaziabad", "gautam budh nagar", "gautam buddha nagar", "noida", "greater noida", "bulandshahr", "bulandshahar", "baghpat", "bagpat", "hapur", "shamli", "muzaffarnagar"],
  rajasthan: ["alwar", "bharatpur"],
};
function inRegion(p: Place, region: string) {
  if (normalized(p.country_code) !== "in") return false;
  const state = normalized(p.state);
  const parts = [p.city, p.county, p.district].map(normalized);
  if (region === "Rajasthan") return state === "rajasthan";
  if (region === "Delhi") {
    return ["delhi", "nct of delhi", "national capital territory of delhi"].includes(state) ||
      Boolean(ncr[state]?.some((name) => parts.includes(name)));
  }
  return Boolean(cities[region]?.some((name) => parts.includes(name)));
}

function selection(p: Place, region: string) {
  if (!inRegion(p, region) || !["suburb", "district", "city", "postcode", "county"].includes(clean(p.result_type))) return null;
  let name = clean(p.suburb) || clean(p.name) || clean(p.address_line1) || clean(p.city);
  // NCR and Rajasthan span cities: distinguish places such as Malviya Nagar.
  const city = clean(p.city);
  if ((region === "Delhi" || region === "Rajasthan") && city && !name.toLowerCase().includes(city.toLowerCase())) name += `, ${city}`;
  if (!name || name.length > 80) return null;
  return { region, name, label: (clean(p.formatted) || [name, region, "India"].join(", ")).slice(0, 300) };
}

const signature = (payload: string, key: string) => createHmac("sha256", key).update(`geoapify-location:${payload}`).digest();
function signLocation(region: string, name: string, key: string) {
  const payload = Buffer.from(JSON.stringify({ region, name, expires: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${payload}.${signature(payload, key).toString("base64url")}`;
}

/** Only search results attested by this server may be added to service_areas. */
export function readLocationToken(token: unknown, key: string, now = Date.now()): { region: string; name: string } | null {
  if (typeof token !== "string" || token.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const [payload, signed] = token.split(".");
    const expected = signature(payload, key);
    const received = Buffer.from(signed, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!supportedRegions.includes(data.region) || typeof data.name !== "string" || !data.name.trim() || data.name.length > 80 || !Number.isFinite(data.expires) || data.expires <= now) return null;
    return { region: data.region, name: data.name };
  } catch { return null; }
}

export async function searchLocations(region: string, query: string, key: string, fetchImpl: typeof fetch = fetch): Promise<LocationSuggestion[]> {
  if (!supportedRegions.some((r) => r === region)) throw new LocationError("Choose a supported region.", 400);
  query = query.trim();
  if (query.length < 3) return [];
  if (query.length > 120) throw new LocationError("Search with fewer than 120 characters.", 400);
  if (!key) throw new LocationError(UNAVAILABLE);
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.search = new URLSearchParams({
    text: region === "Delhi" ? query : `${query}, ${region}`,
    type: "locality", filter: "countrycode:in", lang: "en", format: "json", limit: "10", apiKey: key,
    ...(region === "Delhi" ? { bias: "proximity:77.209,28.6139" } : {}),
  }).toString();
  try {
    const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (response.status === 429) throw new LocationError("Too many location searches. Please wait a moment and try again.", 429);
    if (!response.ok) throw new LocationError(UNAVAILABLE);
    const data = await response.json();
    if (!Array.isArray(data?.results)) throw new LocationError(UNAVAILABLE);
    const found = new Map<string, LocationSuggestion>();
    for (const place of data.results) {
      if (!place || typeof place !== "object") continue;
      const item = selection(place, region);
      if (item && !found.has(item.name.toLowerCase())) found.set(item.name.toLowerCase(), {
        name: item.name, label: item.label, token: signLocation(region, item.name, key),
      });
    }
    return [...found.values()].slice(0, 8);
  } catch (error) {
    if (error instanceof LocationError) throw error;
    throw new LocationError(UNAVAILABLE);
  }
}
