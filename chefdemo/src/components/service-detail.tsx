"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Camera,
  Check,
  Clock3,
  MapPin,
  Utensils,
  AlertCircle,
  ArrowLeft,
  LogIn,
  CheckCircle2,
} from "lucide-react";
import {
  Booking,
  Data,
  Photo,
  Stage,
  date,
  money,
  overtime,
  stageLabels,
  stages,
  statusLabels,
  time,
} from "@/lib/domain";
import * as repo from "@/lib/repository";
import { Heading, Run } from "./ui";

function PhotoSlot({
  readOnly = false,
  photo,
  stage,
  booking,
  busy,
  run,
}: {
  readOnly?: boolean;
  photo?: Photo;
  stage: Stage;
  booking: Booking;
  busy: boolean;
  run: Run;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (photo)
      repo
        .photoUrl(photo)
        .then((url) => {
          if (live) {
            setUrl(url);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [photo]);
  const editable = !readOnly &&
    ["upcoming", "in_progress"].includes(booking.status) &&
    (!["preparing", "after"].includes(stage) ||
      booking.status === "in_progress");
  return (
    <div className={`photo-slot ${photo ? "has-photo" : ""}`}>
      <div className="photo-preview">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <Image
              unoptimized
              width={400}
              height={260}
              src={url}
              alt={`${stageLabels[stage]} for ${booking.customer}`}
            />
          </a>
        ) : (
          <Camera size={25} />
        )}
      </div>
      <div className="photo-caption">
        <b>{stageLabels[stage]}</b>
        {photo && <Check size={14} className="success" />}
      </div>
      <small>
        {photo
          ? `Uploaded ${time(photo.created_at)}`
          : "Required for completion"}
      </small>
      {error && <p className="error-text">{error}</p>}
      {editable ? (
        <label className={`outline-btn upload-label ${busy ? "disabled" : ""}`}>
          <Camera size={13} />
          {photo ? "Replace photo" : "Upload photo"}
          <input
            aria-label={stageLabels[stage]}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void run(
                  () => repo.uploadPhoto(booking.id, stage, file),
                  `${stageLabels[stage]} uploaded`,
                );
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <small className="photo-lock">
          {readOnly ? (photo ? "Uploaded evidence" : "Awaiting chef upload") : booking.status === "completed"
            ? "Service record locked"
            : booking.status === "requested"
              ? "Accept booking first"
              : "Check in to upload"}
        </small>
      )}
    </div>
  );
}
export default function ServiceDetail({
  manager = false,
  booking: b,
  data,
  now,
  busy,
  run,
  onBack,
}: {
  manager?: boolean;
  booking: Booking;
  data: Data;
  now: number;
  busy: boolean;
  run: Run;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState(b.dish_ids);
  const [search, setSearch] = useState("");
  const ot = overtime(b, now);
  const photos = data.photos.filter((p) => p.booking_id === b.id);
  const locked = manager || ["completed", "cancelled"].includes(b.status);
  const saved = [...selected].sort().join() === [...b.dish_ids].sort().join();
  const action = (
    action: Parameters<typeof repo.actOnBooking>[1],
    message: string,
  ) => run(() => repo.actOnBooking(b.id, action), message);
  return (
    <>
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={14} /> BACK TO BOOKINGS
      </button>
      <Heading
        title={b.customer}
        subtitle={`${b.service} · ${b.guests} guests · ${date(b.scheduled_start)}`}
      >
        <span className={`status-pill ${b.status}`}>
          {statusLabels[b.status]}
        </span>
      </Heading>
      {manager && <div className="card section-card section-gap" style={{marginBottom:22}}><h2>Assigned chef</h2><p>{data.profiles.find(p => p.id === b.chef_id)?.name || "Chef"} · {data.profiles.find(p => p.id === b.chef_id)?.email}</p><p className="muted small-copy">Review attendance, selected dishes, kitchen evidence and charges here. The assigned chef records check-in, check-out and uploads photos.</p></div>}
      <div className="service-layout">
        <div>
          <article className="card section-card">
            <div className="section-title">
              <Clock3 size={18} />
              <h2>Chef timings</h2>
              <span className="muted">IST · Asia/Kolkata</span>
            </div>
            <div className="timing-grid">
              <div>
                <span>Scheduled in time</span>
                <b>{time(b.scheduled_start)}</b>
                <small>{date(b.scheduled_start)}</small>
              </div>
              <div>
                <span>Scheduled out time</span>
                <b>{time(b.scheduled_end)}</b>
                <small>{date(b.scheduled_end)}</small>
              </div>
              <div>
                <span>Actual check-in</span>
                <b>{time(b.actual_in)}</b>
                {b.actual_in && <small>{date(b.actual_in)}</small>}
              </div>
              <div>
                <span>Actual check-out</span>
                <b>{time(b.actual_out)}</b>
                {b.actual_out && <small>{date(b.actual_out)}</small>}
              </div>
            </div>
            {ot.minutes > 0 && (
              <div className="overtime-alert" role="status">
                <AlertCircle size={19} />
                <div>
                  <b>Scheduled out time exceeded by {ot.minutes} minutes</b>
                  <p>
                    Additional charge: <strong>{money(ot.amount)}</strong> at{" "}
                    {money(b.overtime_rate)}/hour.{" "}
                    {b.actual_out
                      ? "Final amount recorded."
                      : "Updates until check-out."}
                  </p>
                </div>
              </div>
            )}
            <p className="location-line">
              <MapPin size={14} />
              {b.address}
            </p>
            {b.notes && <p className="service-notes">{b.notes}</p>}
          </article>
          <article className="card section-card">
            <div className="section-title">
              <Utensils size={18} />
              <h2>{manager ? "Selected menu" : "Select dishes"}</h2>
              <span className="tag">{selected.length} selected</span>
            </div>
            <input
              className="search-input"
              aria-label="Search dishes"
              placeholder="Search dishes or cuisine…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="dish-options">
              {data.dishes
                .filter(
                  (d) =>
                    (d.active || selected.includes(d.id)) &&
                    `${d.name} ${d.cuisine}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map((d) => (
                  <label
                    key={d.id}
                    className={`dish-option ${selected.includes(d.id) ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      disabled={
                        locked ||
                        busy ||
                        (!d.active && !selected.includes(d.id))
                      }
                      checked={selected.includes(d.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, d.id]
                            : selected.filter((id) => id !== d.id),
                        )
                      }
                    />
                    <span>
                      <b>{d.name}</b>
                      <small>
                        {d.cuisine}
                        {!d.active ? " · Archived" : ""}
                      </small>
                    </span>
                    <i
                      className={`food-dot ${d.vegetarian ? "veg" : "nonveg"}`}
                      title={d.vegetarian ? "Vegetarian" : "Non-vegetarian"}
                    />
                  </label>
                ))}
            </div>
            {!locked && (
              <div className="save-row">
                <button
                  className="accept btn"
                  disabled={busy || !selected.length || saved}
                  onClick={() =>
                    run(
                      () => repo.actOnBooking(b.id, "save_dishes", selected),
                      "Menu saved",
                    )
                  }
                >
                  {saved ? "Menu saved" : "Save selected dishes"}
                </button>
              </div>
            )}
          </article>
          <article className="card section-card">
            <div className="section-title">
              <Camera size={18} />
              <h2>Kitchen photo updates</h2>
              <span className="tag">{photos.length}/4 uploaded</span>
            </div>
            <p className="muted small-copy">
              Capture entry and kitchen condition before you start, then
              preparation and kitchen condition after cooking. JPG, PNG or WebP
              · up to 5 MB each.
            </p>
            <div className="photos-grid">
              {stages.map((stage) => (
                <PhotoSlot
                  readOnly={manager}
                  key={stage}
                  stage={stage}
                  photo={photos.find((p) => p.stage === stage)}
                  booking={b}
                  busy={busy}
                  run={run}
                />
              ))}
            </div>
          </article>
        </div>
        <aside>
          <article className="card settlement">
            <div className="section-title">
              <h2>{manager ? "Service charges" : "Service earnings"}</h2>
            </div>
            <div className="bill-line">
              <span>Base service fee</span>
              <b>{money(b.base_amount)}</b>
            </div>
            <div className="bill-line">
              <span>Overtime rate</span>
              <b>{money(b.overtime_rate)}/hr</b>
            </div>
            <div className="bill-line">
              <span>Additional time</span>
              <b>{ot.minutes} min</b>
            </div>
            <div className="bill-line">
              <span>Overtime charge</span>
              <b className={ot.minutes ? "warning-text" : ""}>
                {money(b.actual_out ? b.overtime_amount : ot.amount)}
              </b>
            </div>
            <div className="bill-total">
              <span>
                {b.actual_out
                  ? "Final service total"
                  : "Estimated service total"}
              </span>
              <b>
                {money(
                  b.base_amount +
                    (b.actual_out ? b.overtime_amount : ot.amount),
                )}
              </b>
            </div>
            <p className="small-copy muted">
              Overtime starts after the scheduled out time, rounded up to the
              next minute. No grace period.
            </p>
          </article>
          <article className="card section-card">
            <h2>Service checklist</h2>
            <div className="checklist">
              {[
                ["Menu selected", b.dish_ids.length > 0],
                [
                  "Entry & before photos",
                  ["entry", "before"].every((s) =>
                    photos.some((p) => p.stage === s),
                  ),
                ],
                ["Chef checked in", !!b.actual_in],
                [
                  "Preparation & after photos",
                  ["preparing", "after"].every((s) =>
                    photos.some((p) => p.stage === s),
                  ),
                ],
                ["Service completed", !!b.actual_out],
              ].map(([label, done]) => (
                <div key={String(label)} className={done ? "done" : ""}>
                  <CheckCircle2 size={16} />
                  {label}
                </div>
              ))}
            </div>
            {!manager && b.status === "requested" && (
              <div className="action-row">
                <button
                  className="reject"
                  disabled={busy}
                  onClick={() => action("reject", "Booking declined")}
                >
                  Decline
                </button>
                <button
                  className="accept"
                  disabled={busy}
                  onClick={() => action("accept", "Booking accepted")}
                >
                  Accept booking
                </button>
              </div>
            )}
            {!manager && b.status === "upcoming" && (
              <>
                <button
                  className="primary-btn inline-icon"
                  disabled={busy || !saved}
                  onClick={() =>
                    action("check_in", "Checked in. Service started.")
                  }
                >
                  <LogIn size={16} />
                  Check in & start service
                </button>
                <p className="small-copy muted">
                  Select dishes and upload entry and before photos first.
                </p>
              </>
            )}
            {!manager && b.status === "in_progress" && (
              <>
                <button
                  className="primary-btn"
                  disabled={busy || !saved}
                  onClick={() =>
                    action(
                      "complete",
                      "Checked out. Service completed and final charges recorded.",
                    )
                  }
                >
                  Check out & complete
                </button>
                <p className="small-copy muted">
                  All four photos are required. Completion locks this service
                  record.
                </p>
              </>
            )}
            {!saved && (
              <p className="warning-text small-copy">
                Save your dish changes before continuing.
              </p>
            )}
            {b.status === "completed" && (
              <div className="verified-block">
                ✓ Completed · {time(b.actual_out)}
              </div>
            )}
          </article>
        </aside>
      </div>
    </>
  );
}
