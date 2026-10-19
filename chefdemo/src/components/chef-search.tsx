"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import {
  ChefFilter,
  ChefResult,
  ChefType,
  Paged,
  ServiceArea,
  chefTypeLabel,
  chefTypeLabels,
  chefTypes,
  contactOf,
} from "@/lib/domain";
import * as repo from "@/lib/repository";
import { AreaFields, Empty, Field, Heading } from "./ui";
import { Pager } from "./orders";

const PAGE_SIZE = 12;
const blank: ChefFilter = {
  region: "",
  location: "",
  chef_type: "",
  min_experience: 0,
  start: "",
  end: "",
  online_only: false,
};
const ist = (value: string) =>
  value ? new Date(value + ":00+05:30").toISOString() : "";

/** Staff search over approved chefs: area, type, experience and availability.
 *  Filtering and paging happen in the database (search_chefs). */
export function ChefSearch({ areas }: { areas: ServiceArea[] }) {
  const [region, setRegion] = useState("");
  const [location, setLocation] = useState("");
  const [filter, setFilter] = useState<ChefFilter>(blank);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Paged<ChefResult> | null>(null);
  const [error, setError] = useState("");
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    let current = true;
    repo.searchChefs(filter, PAGE_SIZE, offset).then(
      (r) => {
        if (!current) return;
        setResult(r);
        setError("");
      },
      (e) => current && setError(e instanceof Error ? e.message : "Search failed."),
    );
    return () => {
      current = false;
    };
  }, [filter, offset]);
  const available = Boolean(filter.start && filter.end);
  return (
    <>
      <Heading
        title="Find chefs"
        subtitle="Search approved chefs by location, chef type, experience and availability."
      />
      <form
        key={formKey}
        className="card form-card chef-search"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (key: string) => String(f.get(key) ?? "");
          setFilter({
            region,
            location,
            chef_type: get("chef_type") as ChefType | "",
            min_experience: Number(get("min_experience") || 0),
            start: ist(get("start")),
            end: ist(get("end")),
            online_only: f.get("online_only") === "on",
          });
          setOffset(0);
        }}
      >
        <div className="form-grid">
          <AreaFields
            areas={areas}
            region={region}
            location={location}
            onRegion={setRegion}
            onLocation={setLocation}
            regionLabel="Region"
            locationLabel="Serves location"
          />
          <Field label="Chef type">
            <select name="chef_type" defaultValue="">
              <option value="">Any type</option>
              {chefTypes.map((t) => (
                <option key={t} value={t}>
                  {chefTypeLabels[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Minimum experience (years)">
            <input name="min_experience" type="number" min={0} max={80} defaultValue={0} />
          </Field>
          <Field label="Available from (IST)">
            <input name="start" type="datetime-local" />
          </Field>
          <Field label="Available until (IST)">
            <input name="end" type="datetime-local" />
          </Field>
          <label className="checkbox-label full">
            <input type="checkbox" name="online_only" />
            Online now only
          </label>
        </div>
        <div className="save-row chef-search-actions">
          <button
            type="button"
            className="outline-btn"
            onClick={() => {
              setRegion("");
              setLocation("");
              setFilter(blank);
              setOffset(0);
              setFormKey((k) => k + 1);
            }}
          >
            Clear
          </button>
          <button className="accept btn">Search chefs</button>
        </div>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="muted small-copy chef-count" aria-live="polite">
          {result.total} {result.total === 1 ? "chef" : "chefs"} found
          {available ? " · free for the whole time window" : ""}
        </p>
      )}
      <div className="chef-results">
        {result?.rows.map((c) => (
          <article className="card chef-result" key={c.id}>
            <div className="avatar">
              {c.name
                .split(" ")
                .map((s) => s[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div>
              <h3>{c.name}</h3>
              <p>
                {chefTypeLabel(c.chef_type)} · {c.experience} yrs experience
              </p>
              <p className="booking-time">
                <MapPin size={12} />
                {c.location ? `${c.location}, ${c.region}` : "No location set"}
              </p>
              {c.cuisine && <p>{c.cuisine}</p>}
              <p className="muted">{contactOf(c)}</p>
              <span className={`status-pill ${c.online ? "completed" : ""}`}>
                {c.online ? "Online" : "Offline"}
              </span>
            </div>
          </article>
        ))}
      </div>
      {result && !result.rows.length && (
        <Empty title="No chefs match" text="Try a wider area, another type or fewer years." />
      )}
      {result && (
        <Pager offset={offset} total={result.total} limit={PAGE_SIZE} onOffset={setOffset} />
      )}
    </>
  );
}
