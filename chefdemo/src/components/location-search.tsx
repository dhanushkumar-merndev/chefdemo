"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ServiceArea } from "@/lib/domain";
import type { LocationSuggestion } from "@/lib/service-areas";
import { searchServiceLocations, selectServiceLocation } from "@/lib/repository";

export function LocationSearch({ region, onSelect }: { region: string; onSelect: (area: ServiceArea) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  useEffect(() => {
    if (query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("Searching locations…");
      try {
        const found = await searchServiceLocations(region, query.trim(), controller.signal);
        if (controller.signal.aborted) return;
        setSuggestions(found);
        setStatus(found.length ? `${found.length} locations found. Choose one below.` : "No matching localities found. Try a nearby area or a saved location.");
      } catch (failure) {
        if (!controller.signal.aborted) {
          setStatus("");
          setError(failure instanceof Error ? failure.message : "Location search is unavailable. Please try again.");
        }
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [region, query]);

  async function choose(suggestion: LocationSuggestion) {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setSaving(true);
    setError("");
    setStatus("Selecting location…");
    try {
      const area = await selectServiceLocation(suggestion.token, controller.signal);
      if (!controller.signal.aborted) {
        setQuery("");
        setSuggestions([]);
        setStatus("Location selected.");
        onSelect(area);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Could not select this location. Try again.");
        setStatus("");
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <div className="location-search full">
      <label className="field" htmlFor={id}>
        <span>Search localities</span>
        <input
          id={id} type="search" value={query} maxLength={120} autoComplete="off"
          disabled={saving} placeholder={`Search an area in ${region === "Delhi" ? "Delhi / NCR" : region}`}
          aria-describedby={`${id}-hint ${id}-status`}
          onChange={(e) => { setQuery(e.target.value); setSuggestions([]); setError(""); setStatus(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        />
      </label>
      <p id={`${id}-hint`} className="muted small-copy">Choose a saved location above, or type at least 3 characters to find another area.</p>
      <p id={`${id}-status`} className="muted small-copy" role="status">{status}</p>
      {error && <p className="error-text small-copy" role="alert">{error}</p>}
      {suggestions.length > 0 && (
        <ul className="location-suggestions" aria-label="Location suggestions">
          {suggestions.map((suggestion) => (
            <li key={suggestion.token}>
              <button type="button" disabled={saving} onClick={() => void choose(suggestion)}>{suggestion.label}</button>
            </li>
          ))}
        </ul>
      )}
      <small className="location-attribution">
        Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>
        {" · "}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      </small>
    </div>
  );
}
