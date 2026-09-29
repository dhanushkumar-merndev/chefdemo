import { test } from "node:test";
import assert from "node:assert/strict";
import { searchLocations, readLocationToken } from "../src/lib/geoapify";
import { servesArea, mergeServiceAreas } from "../src/lib/service-areas";

const places = [
  { country_code: "in", state: "Tamil Nadu", city: "Chennai", suburb: "Velachery", formatted: "Velachery, Chennai, India", result_type: "suburb" },
  { country_code: "in", state: "Karnataka", city: "Bangalore", suburb: "Velachery", formatted: "Velachery, Bangalore, India", result_type: "suburb" },
  { country_code: "us", city: "Chennai", suburb: "Velachery", result_type: "suburb" },
];
const fetchPlaces = (results: unknown[]) => (async () => Response.json({ results })) as typeof fetch;

test("location search filters countries and regions, deduplicates and signs verified selections", async () => {
  const suggestions = await searchLocations("Chennai", "Vela", "secret", async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.geoapify.com");
    assert.equal(url.searchParams.get("filter"), "countrycode:in");
    assert.equal(url.searchParams.get("type"), "locality");
    return Response.json({ results: [...places, places[0]] });
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].name, "Velachery");
  assert.deepEqual(readLocationToken(suggestions[0].token, "secret"), { region: "Chennai", name: "Velachery" });
  assert.equal(readLocationToken(suggestions[0].token + "x", "secret"), null);
  assert.equal(readLocationToken(suggestions[0].token, "wrong-key"), null);
  assert.equal(readLocationToken(suggestions[0].token, "secret", Date.now() + 3_600_000), null);
  const [payload, signature] = suggestions[0].token.split(".");
  const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
  forged.region = "Mumbai";
  assert.equal(readLocationToken(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`, "secret"), null);
});

test("Delhi includes NCR while Rajasthan searches exclude other states", async () => {
  const results = [
    { country_code: "in", state: "Uttar Pradesh", city: "Noida", county: "Dadri", suburb: "Sector 62", result_type: "suburb" },
    { country_code: "in", state: "Rajasthan", city: "Jaipur", suburb: "Malviya Nagar", result_type: "suburb" },
    { country_code: "in", state: "Uttar Pradesh", city: "Lucknow", suburb: "Gomti Nagar", result_type: "suburb" },
  ];
  assert.deepEqual((await searchLocations("Delhi", "Sector", "key", fetchPlaces(results))).map((s) => s.name), ["Sector 62, Noida"]);
  assert.deepEqual((await searchLocations("Rajasthan", "Malviya", "key", fetchPlaces(results))).map((s) => s.name), ["Malviya Nagar, Jaipur"]);
});

test("invalid queries never call Geoapify and upstream errors never disclose the key", async () => {
  const noFetch = (async () => { throw new Error("Must not fetch"); }) as typeof fetch;
  await assert.rejects(searchLocations("London", "street", "key", noFetch), /supported region/);
  assert.deepEqual(await searchLocations("Chennai", "ab", "key", noFetch), []);
  await assert.rejects(searchLocations("Chennai", "Velachery", "secret", async () => { throw new Error("secret URL"); }), /Location search is unavailable/);
  await assert.rejects(searchLocations("Chennai", "Velachery", "secret", async () => Response.json({}, { status: 429 })), /Too many/);
});

test("region-wide chefs match only the same region and empty profiles never match", () => {
  assert.equal(servesArea({ region: "Chennai", location: "All locations" }, "Chennai", "Velachery"), true);
  assert.equal(servesArea({ region: "Chennai", location: "Velachery" }, "Chennai", "All locations"), true);
  assert.equal(servesArea({ region: "Mumbai", location: "All locations" }, "Chennai", "All locations"), false);
  assert.equal(servesArea({ region: "Mumbai", location: "Adyar" }, "Chennai", "Adyar"), false);
  assert.equal(servesArea({ region: "Chennai", location: "" }, "Chennai", "All locations"), false);
  assert.equal(servesArea({ region: "Delhi", location: "NCR" }, "Delhi", "Sector 62, Noida"), true);
});

test("demo area upgrades preserve saved IDs, disabled entries and custom places", () => {
  const existing = [{ id: "saved", region: "Chennai", name: "Adyar", active: false }, { id: "custom", region: "Chennai", name: "Velachery", active: true }];
  const defaults = [{ id: "custom", region: "Delhi", name: "NCR", active: true }, { id: "new", region: "Chennai", name: "Adyar", active: true }];
  const merged = mergeServiceAreas(existing, defaults);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.slice(0, 2), existing);
  assert.equal(new Set(merged.map((a) => a.id)).size, 3);
  assert.deepEqual(mergeServiceAreas(merged, defaults), merged);
});
