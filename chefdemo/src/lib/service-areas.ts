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
  for (const area of defaults) {
    if (!merged.some((a) => a.region === area.region && a.name === area.name)) {
      merged.push({ ...area, id: merged.some((a) => a.id === area.id) ? crypto.randomUUID() : area.id });
    }
  }
  return merged;
}

export type LocationSuggestion = { name: string; label: string; token: string };
