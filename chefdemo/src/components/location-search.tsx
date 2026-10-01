"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ServiceArea } from "@/lib/domain";
import type { LocationSuggestion } from "@/lib/service-areas";
import { searchServiceLocations, selectServiceLocation } from "@/lib/repository";

type Choice =
  | { kind: "saved"; key: string; name: string; label: string }
  | { kind: "remote"; key: string; name: string; label: string; suggestion: LocationSuggestion };

export function LocationSearch({
  region,
  location,
  locations,
  label,
  required,
  searchable,
  onLocation,
  onSelect,
}: {
  region: string;
  location: string;
  locations: string[];
  label: string;
  required?: boolean;
  searchable: boolean;
  onLocation: (location: string) => void;
  onSelect: (area: ServiceArea) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(location);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => () => selection.current?.abort(), []);
  useEffect(() => {
    input.current?.setCustomValidity(required && !location ? "Choose a location from the list." : "");
  }, [location, required]);
  useEffect(() => {
    if (!searchable || query.trim().length < 3 || query === location) {
      setSuggestions([]);
      return;
    }
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
  }, [location, query, region, searchable]);

  const choices = useMemo<Choice[]>(() => {
    const term = query === location ? "" : query.trim().toLowerCase();
    const saved = locations
      .filter((name) => !term || name.toLowerCase().includes(term))
      .map((name): Choice => ({ kind: "saved", key: `saved:${name}`, name, label: name }));
    const savedNames = new Set(saved.map((choice) => choice.name.toLowerCase()));
    return [
      ...saved,
      ...suggestions
        .filter((suggestion) => !savedNames.has(suggestion.name.toLowerCase()))
        .map((suggestion): Choice => ({
          kind: "remote",
          key: `remote:${suggestion.token}`,
          name: suggestion.name,
          label: suggestion.label,
          suggestion,
        })),
    ];
  }, [location, locations, query, suggestions]);

  useEffect(() => setActiveIndex(-1), [query, suggestions]);

  function chooseSaved(name: string) {
    setQuery(name);
    setSuggestions([]);
    setStatus("Location selected.");
    setError("");
    setOpen(false);
    onLocation(name);
  }

  async function chooseRemote(suggestion: LocationSuggestion) {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setSaving(true);
    setError("");
    setStatus("Selecting location…");
    try {
      const area = await selectServiceLocation(suggestion.token, controller.signal);
      if (!controller.signal.aborted) {
        setQuery(area.name);
        setSuggestions([]);
        setStatus("Location selected.");
        setOpen(false);
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

  function choose(choice: Choice) {
    if (choice.kind === "saved") chooseSaved(choice.name);
    else void chooseRemote(choice.suggestion);
  }

  return (
    <div
      className="location-search full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className="location-combobox">
          <input
            ref={input}
            id={id}
            name="location"
            type="search"
            role="combobox"
            value={query}
            maxLength={120}
            autoComplete="off"
            required={required}
            disabled={!region || saving}
            placeholder={region ? "Select or type a location" : "Select a region first"}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
            aria-describedby={`${id}-hint ${id}-status`}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestions([]);
              setError("");
              setStatus("");
              setOpen(true);
              if (location) onLocation("");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => Math.min(index + 1, choices.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                if (open) event.preventDefault();
                if (activeIndex >= 0 && choices[activeIndex]) choose(choices[activeIndex]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="location-combobox-toggle"
            disabled={!region || saving}
            aria-label={open ? "Hide location options" : "Show location options"}
            onClick={() => {
              setOpen((shown) => !shown);
              input.current?.focus();
            }}
          >
            <ChevronDown size={17} aria-hidden="true" />
          </button>
          {open && choices.length > 0 && (
            <ul id={`${id}-options`} className="location-suggestions" role="listbox" aria-label="Location suggestions">
              {choices.map((choice, index) => (
                <li key={choice.key} role="none">
                  <button
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={choice.name === location}
                    disabled={saving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(choice)}
                  >
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p id={`${id}-hint`} className="muted small-copy">
        {!region ? "Choose a region first." : searchable ? "Choose a saved location or type at least 3 characters to find another area." : "Choose a saved location."}
      </p>
      <p id={`${id}-status`} className="muted small-copy" role="status">{status}</p>
      {error && <p className="error-text small-copy" role="alert">{error}</p>}
    </div>
  );
}
