import type { ServiceArea } from "./domain";

export const supportedRegions = ["Bengaluru", "Chennai", "Delhi", "Hyderabad", "Mumbai", "Rajasthan"] as const;

export function servesArea(chef: { region: string; location: string }, region: string, location: string) {
  return Boolean(region && location && chef.location && chef.region === region && (
    chef.location === location || chef.location === "All locations" || location === "All locations" ||
    (region === "Delhi" && (chef.location === "NCR" || location === "NCR"))
  ));
}

/** Upgrade old demo sessions without replacing user data or reactivating areas. */
export function mergeServiceAreas(existing: ServiceArea[], defaults: ServiceArea[]) {
  const merged = [...existing];
  // Sets, not scans: the full locality list has thousands of entries.
  const names = new Set(existing.map((a) => `${a.region}\u0000${a.name}`));
  const ids = new Set(existing.map((a) => a.id));
  for (const area of defaults) {
    const key = `${area.region}\u0000${area.name}`;
    if (names.has(key)) continue;
    const id = ids.has(area.id) ? crypto.randomUUID() : area.id;
    merged.push({ ...area, id });
    names.add(key);
    ids.add(id);
  }
  return merged;
}

export type LocationSuggestion = { name: string; label: string; token: string };
