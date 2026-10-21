#!/usr/bin/env node
// Downloads every locality (suburb / neighbourhood / quarter) of each service
// region through the Geoapify Places API (OpenStreetMap data) and writes:
//   src/lib/localities.json                                       demo-mode list
//   supabase/migrations/202610210001_service_area_localities.sql  live insert
// Re-run to refresh; the migration only inserts names that do not exist yet.
// Costs roughly one Geoapify credit per 20 localities (a few hundred in all).
//
//   node --env-file=.env scripts/fetch-localities.mjs
import { writeFile } from "node:fs/promises";

const key = process.env.GEOAPIFY_API_KEY;
const LOCALITIES = "populated_place.suburb,populated_place.neighbourhood,populated_place.quarter";
const TOWNS = "populated_place.city,populated_place.town";
// Boundary searches alone miss places (Geoapify's "Delhi" boundary covers part
// of the city), so each region combines its boundaries with a circle around
// the city kept to places whose address is in the region, as inRegion does in
// src/lib/geoapify.ts. Delhi adds NCR cities, Rajasthan every city and town.
const parts = (p) => [p.city, p.county, p.district].map((v) => String(v ?? "").toLowerCase().replace(/ district$/, ""));
const inPlace = (...names) => (p) => parts(p).some((v) => names.includes(v));
const regions = {
  Bengaluru: {
    areas: [{ text: "Bengaluru Urban, Karnataka", type: "county" }],
    circles: [{ lon: 77.5946, lat: 12.9716, radius: 35000,
      keep: (p) => p.state === "Karnataka" && parts(p).some((v) => /^(bengaluru|bangalore)\b/.test(v)) }],
  },
  Chennai: {
    areas: [{ text: "Chennai, Tamil Nadu", type: "city" }],
    circles: [{ lon: 80.2707, lat: 13.0827, radius: 25000, keep: inPlace("chennai") }],
  },
  Hyderabad: {
    areas: [{ text: "Hyderabad, Telangana", type: "city" }],
    circles: [{ lon: 78.4867, lat: 17.385, radius: 30000, keep: inPlace("hyderabad", "secunderabad") }],
  },
  Mumbai: {
    areas: [
      { text: "Mumbai, Maharashtra", type: "city" },
      { text: "Mumbai Suburban, Maharashtra", type: "county" },
    ],
    circles: [{ lon: 72.8777, lat: 19.076, radius: 30000, keep: inPlace("mumbai", "mumbai suburban", "mumbai city") }],
  },
  Delhi: {
    areas: [{ text: "Delhi, India", type: "city" }],
    circles: [{ lon: 77.209, lat: 28.6139, radius: 35000, keep: (p) => p.state === "Delhi" }],
    // Named "Sector 29, Gurugram", as the Geoapify search names NCR places.
    ncr: {
      Gurugram: { area: { text: "Gurugram, Haryana", type: "city" },
        circle: { lon: 77.0266, lat: 28.4595, radius: 18000, keep: inPlace("gurugram", "gurgaon") } },
      Faridabad: { area: { text: "Faridabad, Haryana", type: "city" },
        circle: { lon: 77.3178, lat: 28.4089, radius: 15000, keep: inPlace("faridabad") } },
      Noida: { area: { text: "Noida, Uttar Pradesh", type: "city" },
        circle: { lon: 77.391, lat: 28.5355, radius: 18000, keep: inPlace("noida", "greater noida", "gautam buddha nagar", "gautam budh nagar") } },
      Ghaziabad: { area: { text: "Ghaziabad, Uttar Pradesh", type: "city" },
        circle: { lon: 77.4538, lat: 28.6692, radius: 15000, keep: inPlace("ghaziabad") } },
    },
  },
  Rajasthan: { areas: [{ text: "Rajasthan, India", type: "state" }], circles: [], towns: true },
};

async function geoapify(path, params) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://api.geoapify.com${path}?${new URLSearchParams({ ...params, apiKey: key })}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return response.json();
    if (attempt === 4 || ![429, 500, 502, 503, 504].includes(response.status))
      throw new Error(`Geoapify ${path} answered ${response.status}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

async function boundary({ text, type }) {
  // The geocoder's `type` filter has no "county", so match result_type instead.
  const { results = [] } = await geoapify("/v1/geocode/search", { text, filter: "countrycode:in", format: "json", limit: "5" });
  const match = results.find((r) => r.result_type === type);
  if (!match?.place_id) throw new Error(`No ${type} found for "${text}" (got ${results.map((r) => r.result_type).join(", ")})`);
  return match.place_id;
}

/** Every place of the given categories inside a filter (a boundary or a circle), page by page. */
async function places(filter, categories) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const { features = [] } = await geoapify("/v2/places", { categories, filter, limit: "500", offset: String(offset) });
    all.push(...features);
    if (features.length < 500) return all;
  }
}
const within = async (areaSpec) => `place:${await boundary(areaSpec)}`;
const around = ({ lon, lat, radius }) => `circle:${lon},${lat},${radius}`;
/** Localities in the boundaries plus those in the circle whose address matches. */
async function localities(areaSpecs, circles) {
  const found = [];
  for (const a of areaSpecs) found.push(...(await places(await within(a), LOCALITIES)));
  for (const c of circles) found.push(...(await places(around(c), LOCALITIES)).filter((f) => c.keep(f.properties)));
  return found;
}

/** A readable English name, or null for names we should not offer. */
export function cleanName(properties) {
  const raw = String(properties.name_international?.en || properties.name || "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 60) return null;
  if (/[^\x20-\x7E]/.test(raw)) return null; // non-Latin script without an English name
  if (/^[\d\s\-/]+$/.test(raw)) return null; // bare numbers
  return raw;
}
// "1st Block", "Sector 10", "Pocket A": meaningless without their area. Kept
// when suffixed with a city ("Sector 29, Gurugram").
const contextFree = /^(\d+\s*(st|nd|rd|th)?\s+(block|phase|stage|sector|cross|main|layout|ward)|(block|sector|phase|stage|ward|pocket)\s*[\w-]{1,4})$/i;
const at = (f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
const distance = (a, b) => (a.lat - b.lat) ** 2 + ((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2;

async function regionLocalities(region, spec) {
  const names = new Map(); // lower-case → display name
  const add = (name) => {
    if (name && name.length <= 80 && name.toLowerCase() !== region.toLowerCase() && !names.has(name.toLowerCase())
      && !(name.indexOf(", ") < 0 && contextFree.test(name)))
      names.set(name.toLowerCase(), name);
  };
  if (spec.towns) {
    const state = await within(spec.areas[0]);
    const towns = (await places(state, TOWNS)).filter((f) => cleanName(f.properties));
    const cities = towns.filter((f) => f.properties.categories?.includes("populated_place.city"));
    for (const town of towns) add(cleanName(town.properties));
    for (const f of await places(state, LOCALITIES)) {
      const name = cleanName(f.properties);
      const near = cities.length
        ? cities.reduce((best, c) => (distance(at(c), at(f)) < distance(at(best), at(f)) ? c : best))
        : null;
      if (name && near) add(`${name}, ${cleanName(near.properties)}`);
    }
  } else {
    for (const f of await localities(spec.areas, spec.circles)) add(cleanName(f.properties));
  }
  for (const [city, { area, circle }] of Object.entries(spec.ncr ?? {})) {
    add(city);
    for (const f of await localities([area], [circle])) {
      const name = cleanName(f.properties);
      if (name) add(name.toLowerCase().includes(city.toLowerCase()) ? name : `${name}, ${city}`);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

const sql = (s) => `'${s.replaceAll("'", "''")}'`;

async function main() {
  if (!key) throw new Error("Set GEOAPIFY_API_KEY (node --env-file=.env scripts/fetch-localities.mjs).");
  const result = {};
  for (const [region, spec] of Object.entries(regions)) {
    result[region] = await regionLocalities(region, spec);
    console.log(`${region}: ${result[region].length} localities`);
  }
  await writeFile(new URL("../src/lib/localities.json", import.meta.url), JSON.stringify(result) + "\n");
  const rows = Object.entries(result).flatMap(([region, names]) => names.map((n) => `(${sql(region)},${sql(n)})`));
  await writeFile(
    new URL("../supabase/migrations/202610210001_service_area_localities.sql", import.meta.url),
    `-- Generated by scripts/fetch-localities.mjs via Geoapify (© OpenStreetMap contributors, ODbL).
-- Every suburb/neighbourhood of each service region, so chefs can pick their
-- area from the full list. Existing rows (including disabled ones) are kept.
begin;
insert into public.service_areas(region, name) values
${rows.join(",\n")}
on conflict(region, name) do nothing;
commit;
`,
  );
  console.log(`Wrote ${rows.length} localities.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
