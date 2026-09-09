"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Home,
  IndianRupee,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  UserRound,
  Users,
  Utensils,
  WalletCards,
} from "lucide-react";
import {
  Booking,
  Data,
  Profile,
  Status,
  date,
  dayKey,
  money,
  overtime,
  statusLabels,
  time,
} from "@/lib/domain";
import { supabase } from "@/lib/supabase";
import * as repo from "@/lib/repository";
import {
  Analytics,
  Dishes,
  Metric,
  NewBookingModal,
  Staff,
  exportBookings,
} from "./admin";
import ServiceDetail from "./service-detail";
import { Brand, Empty, Field, Heading, Modal, Run } from "./ui";

type Page =
  | "dashboard"
  | "bookings"
  | "calendar"
  | "earnings"
  | "ratings"
  | "profile"
  | "support"
  | "analytics"
  | "staff"
  | "dishes";
const nav = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "bookings", label: "Bookings", icon: CalendarDays },
  { id: "earnings", label: "Earnings", icon: WalletCards },
  { id: "ratings", label: "Ratings & performance", icon: Star },
  { id: "dishes", label: "Dish library", icon: Utensils },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "support", label: "Support & help", icon: CircleHelp },
] as const;
const adminNav = [
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "staff", label: "Team & roles", icon: Users },
] as const;

function Login({
  onLogin,
  notify,
}: {
  onLogin: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="login-screen">
      <div className="login-art">
        <Brand />
        <div className="login-copy">
          <h1>
            Your kitchen.
            <br />
            Your schedule.
            <br />
            Your growth.
          </h1>
          <p>
            Create memorable dining experiences, with every detail taken care
            of.
          </p>
        </div>
        <div className="login-steps">
          <div>
            <b>01</b>Plan your menu
          </div>
          <div>
            <b>02</b>Make it memorable
          </div>
          <div>
            <b>03</b>Grow your business
          </div>
        </div>
      </div>
      <div className="login-form-area">
        <div className="login-box">
          <h2>{signup ? "Join ChefFlow" : "Welcome, Chef!"}</h2>
          <p>
            {repo.isDemo
              ? "Explore your chef workspace or manage the team from the admin panel."
              : "Sign in to your ChefFlow workspace."}
          </p>
          {repo.isDemo ? (
            <>
              <button
                className="primary-btn"
                onClick={async () => {
                  repo.demoLogin("chef");
                  await onLogin();
                }}
              >
                Explore chef dashboard
              </button>
              <button
                className="outline-btn demo-admin"
                onClick={async () => {
                  repo.demoLogin("admin");
                  await onLogin();
                }}
              >
                Open admin panel
              </button>
              <p className="login-note">
                Demo mode · Sample data saved in this browser.
                <br />
                Supabase is not connected.
              </p>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  if (signup) {
                    const hasSession = await repo.register(
                      String(f.get("name")),
                      String(f.get("email")),
                      String(f.get("password")),
                    );
                    if (!hasSession) {
                      notify(
                        "Account created. Check your email to confirm, then sign in.",
                      );
                      setSignup(false);
                      return;
                    }
                  } else
                    await repo.login(
                      String(f.get("email")),
                      String(f.get("password")),
                    );
                  await onLogin();
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : "Sign-in failed",
                    true,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="login-fields">
                {signup && (
                  <Field label="Full name">
                    <input
                      name="name"
                      required
                      maxLength={120}
                      autoComplete="name"
                    />
                  </Field>
                )}
                <Field label="Email">
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={8}
                    autoComplete={signup ? "new-password" : "current-password"}
                  />
                </Field>
              </div>
              <button className="primary-btn" disabled={busy}>
                {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
              </button>
              <button
                type="button"
                className="back-login"
                onClick={() => setSignup(!signup)}
              >
                {signup
                  ? "Already registered? Sign in"
                  : "New staff member? Create account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function BookingRow({
  b,
  onOpen,
  compact,
  now,
}: {
  b: Booking;
  onOpen: (id: string) => void;
  compact?: boolean;
  now: number;
}) {
  const d = new Date(b.scheduled_start);
  const ot = overtime(b, now);
  return (
    <button
      className={`booking-row ${compact ? "compact" : "card"}`}
      onClick={() => onOpen(b.id)}
    >
      <div className="booking-date">
        {d
          .toLocaleDateString("en-IN", {
            month: "short",
            timeZone: "Asia/Kolkata",
          })
          .toUpperCase()}
        <b>
          {d.toLocaleDateString("en-IN", {
            day: "2-digit",
            timeZone: "Asia/Kolkata",
          })}
        </b>
        {d
          .toLocaleDateString("en-IN", {
            weekday: "short",
            timeZone: "Asia/Kolkata",
          })
          .toUpperCase()}
      </div>
      <div className="booking-main">
        <h3>{b.customer}</h3>
        <p>
          {b.service} · {b.guests} guests
        </p>
        <p className="booking-time">
          <Clock3 size={12} />
          {time(b.scheduled_start)} – {time(b.scheduled_end)} IST
        </p>
        <div className="booking-tags">
          <span className={`status-pill ${b.status}`}>
            {statusLabels[b.status]}
          </span>
          {ot.minutes > 0 && (
            <span className="status-pill overtime">
              +{ot.minutes} min · {money(ot.amount)}
            </span>
          )}
        </div>
      </div>
      <div className="booking-side">
        <b>
          {money(
            b.base_amount + (b.actual_out ? b.overtime_amount : ot.amount),
          )}
        </b>
        <span>{b.actual_out ? "Final total" : "Service fee + overtime"}</span>
      </div>
      <ChevronRight size={16} />
    </button>
  );
}

function Dashboard({
  data,
  user,
  now,
  open,
  go,
  run,
  busy,
}: {
  data: Data;
  user: Profile;
  now: number;
  open: (id: string) => void;
  go: (p: Page) => void;
  run: Run;
  busy: boolean;
}) {
  const upcoming = data.bookings
    .filter((b) => b.status === "upcoming")
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const active = data.bookings.filter((b) => b.status === "in_progress");
  const request = data.bookings.find((b) => b.status === "requested");
  const done = data.bookings.filter((b) => b.status === "completed");
  const earned = done.reduce(
    (s, b) => s + b.base_amount + b.overtime_amount,
    0,
  );
  const rating = data.reviews.length
    ? (
        data.reviews.reduce((s, r) => s + r.rating, 0) / data.reviews.length
      ).toFixed(1)
    : "—";
  const today = data.bookings.filter(
    (b) =>
      dayKey(b.scheduled_start) === dayKey(now) && b.status !== "cancelled",
  );
  return (
    <>
      <section className="greeting">
        <div>
          <h1>
            Hello, {user.name.split(" ")[0]}{" "}
            <span className="verified">
              {user.role === "chef" ? "CHEF PARTNER" : user.role.toUpperCase()}
            </span>
          </h1>
          <p>Here’s what your kitchen has on the menu today.</p>
        </div>
        <div className="date-chip">
          <CalendarDays size={13} />
          {date(new Date(now).toISOString())}
        </div>
      </section>
      <div className="overview">
        <Metric
          label="TODAY'S BOOKINGS"
          value={today.length}
          icon={<CalendarDays />}
        />
        <Metric
          label="TODAY'S EARNINGS"
          value={money(
            done
              .filter((b) => dayKey(b.actual_out!) === dayKey(now))
              .reduce((s, b) => s + b.base_amount + b.overtime_amount, 0),
          )}
          icon={<IndianRupee />}
        />
        <Metric label="AVERAGE RATING" value={rating} icon={<Star />} />
        <Metric
          label="PENDING ACTIONS"
          value={
            active.length +
            data.bookings.filter((b) => b.status === "requested").length
          }
          icon={<Bell />}
        />
      </div>
      <section className="content-grid">
        <div>
          {active.map((b) => (
            <article className="card active-service" key={b.id}>
              <div>
                <span className="eyebrow">● SERVICE IN PROGRESS</span>
                <h2>{b.customer}</h2>
                <p>
                  Checked in {time(b.actual_in)} · Scheduled out{" "}
                  {time(b.scheduled_end)}
                </p>
                {overtime(b, now).minutes > 0 && (
                  <span className="overtime-live">
                    Out time exceeded · {overtime(b, now).minutes} min ·
                    Additional {money(overtime(b, now).amount)}
                  </span>
                )}
              </div>
              <button className="accept btn" onClick={() => open(b.id)}>
                Update service <ChevronRight size={14} />
              </button>
            </article>
          ))}
          <article className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Upcoming bookings</h2>
                <p className="card-sub">
                  Your confirmed services, with chef timings
                </p>
              </div>
              <button className="text-button" onClick={() => go("bookings")}>
                VIEW ALL <ChevronRight size={13} />
              </button>
            </div>
            <div className="booking-list">
              {upcoming.slice(0, 3).map((b) => (
                <BookingRow key={b.id} b={b} compact onOpen={open} now={now} />
              ))}
              {!upcoming.length && (
                <Empty
                  title="Your schedule is clear"
                  text="Accepted requests will appear here."
                />
              )}
            </div>
            <div className="upcoming-footer">
              <span>
                <i className="status-dot" />
                {upcoming.length} upcoming services
              </span>
              <button className="text-button" onClick={() => go("calendar")}>
                VIEW CALENDAR
              </button>
            </div>
          </article>
          <div className="bottom-row">
            <article className="card wallet">
              <h2 className="card-title">Completed service earnings</h2>
              <div className="wallet-balance">{money(earned)}</div>
              <p>
                Includes{" "}
                {money(done.reduce((s, b) => s + b.overtime_amount, 0))} in
                overtime
              </p>
              <button onClick={() => go("earnings")}>
                VIEW EARNINGS <ChevronRight size={13} />
              </button>
            </article>
            <article className="card tip">
              <div className="tip-icon">
                <Sparkles />
              </div>
              <div>
                <b>A great service, from start to finish</b>
                <p>
                  Choose your dishes and capture all four kitchen photos. A
                  clean kitchen is the perfect finishing touch.
                </p>
              </div>
            </article>
          </div>
        </div>
        <div>
          <article className="card booking-panel">
            <div className="card-head">
              <div>
                <h2 className="card-title">New booking request</h2>
                <p className="card-sub">
                  Your next memorable dining experience
                </p>
              </div>
            </div>
            {request ? (
              <div className="new-booking">
                <span className="status">AWAITING YOUR RESPONSE</span>
                <h3>{request.service}</h3>
                <p>
                  By {request.customer} · {request.address}
                </p>
                <div className="booking-meta">
                  <div>
                    DATE<b>{date(request.scheduled_start)}</b>
                  </div>
                  <div>
                    GUESTS<b>{request.guests} people</b>
                  </div>
                  <div>
                    CHEF IN TIME<b>{time(request.scheduled_start)}</b>
                  </div>
                  <div>
                    CHEF OUT TIME<b>{time(request.scheduled_end)}</b>
                  </div>
                </div>
                <div className="earn">
                  <span>Base service earnings</span>
                  <strong>{money(request.base_amount)}</strong>
                </div>
                <p className="rate-note">
                  Overtime: {money(request.overtime_rate)}/hour after out time
                </p>
                <div className="action-row">
                  <button
                    className="reject"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => repo.actOnBooking(request.id, "reject"),
                        "Request declined",
                      )
                    }
                  >
                    Decline
                  </button>
                  <button
                    className="accept"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => repo.actOnBooking(request.id, "accept"),
                        "Booking accepted",
                      )
                    }
                  >
                    Accept booking
                  </button>
                </div>
                <button
                  className="text-button request-details"
                  onClick={() => open(request.id)}
                >
                  VIEW DETAILS <ChevronRight size={13} />
                </button>
              </div>
            ) : (
              <div className="new-booking">
                <Empty
                  title="You're all caught up"
                  text="New booking requests will appear here."
                />
              </div>
            )}
          </article>
          <article className="card section-gap">
            <div className="card-head">
              <div>
                <h2 className="card-title">Ratings & performance</h2>
                <p className="card-sub">
                  Based on {data.reviews.length} customer reviews
                </p>
              </div>
              <button className="text-button" onClick={() => go("ratings")}>
                VIEW REPORT
              </button>
            </div>
            <div className="performance">
              <div className="rating-circle">
                <b>{rating}</b>
                <span>out of 5.0</span>
              </div>
              <div>
                <div className="score">
                  <span>Completed services</span>
                  <b>{done.length}</b>
                </div>
                <div className="score">
                  <span>Photo records complete</span>
                  <b>
                    {
                      done.filter(
                        (b) =>
                          data.photos.filter((p) => p.booking_id === b.id)
                            .length === 4,
                      ).length
                    }
                    /{done.length}
                  </b>
                </div>
                <p className="muted small-copy">
                  Every detail makes a difference.
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function Calendar({
  data,
  now,
  open,
}: {
  data: Data;
  now: number;
  open: (id: string) => void;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1),
  );
  const [selected, setSelected] = useState("");
  const year = month.getFullYear(),
    m = month.getMonth();
  const length = new Date(year, m + 1, 0).getDate();
  const key = (day: number) =>
    `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const list = data.bookings.filter(
    (b) => b.status !== "cancelled" && dayKey(b.scheduled_start) === selected,
  );
  return (
    <>
      <Heading
        title="Booking calendar"
        subtitle="Select a date to see its services and chef timings."
      />
      <article className="card calendar-card">
        <div className="calendar-top">
          <button
            className="calendar-arrow"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
          >
            <ChevronLeft />
          </button>
          <h2>
            {month.toLocaleDateString("en-IN", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            className="calendar-arrow"
            aria-label="Next month"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
          >
            <ChevronRight />
          </button>
        </div>
        <div className="calendar-grid">
          {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
            <div className="weekday" key={d}>
              {d}
            </div>
          ))}
          {Array.from({ length: month.getDay() }, (_, i) => (
            <div key={`blank${i}`} />
          ))}
          {Array.from({ length }, (_, i) => i + 1).map((day) => {
            const count = data.bookings.filter(
              (b) =>
                b.status !== "cancelled" &&
                dayKey(b.scheduled_start) === key(day),
            ).length;
            return (
              <button
                key={day}
                aria-label={`${key(day)}, ${count} bookings`}
                className={`day ${count ? "booked" : ""} ${dayKey(now) === key(day) ? "today" : ""} ${selected === key(day) ? "selected-day" : ""}`}
                onClick={() => setSelected(key(day))}
              >
                {day}
                {count > 0 && <small>{count} services</small>}
              </button>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span>
            <i />
            Confirmed / requested
          </span>
          <span>
            <i className="today-dot" />
            Today
          </span>
        </div>
      </article>
      {selected && (
        <div className="section-gap">
          <h2 className="card-title">{date(selected + "T12:00:00+05:30")}</h2>
          {list.map((b) => (
            <BookingRow key={b.id} b={b} now={now} onOpen={open} />
          ))}
          {!list.length && (
            <Empty
              title="No services on this date"
              text="Choose a highlighted date to view bookings."
            />
          )}
        </div>
      )}
    </>
  );
}

function ProfilePage({
  user,
  busy,
  run,
}: {
  user: Profile;
  busy: boolean;
  run: Run;
}) {
  return (
    <>
      <Heading
        title={user.role === "chef" ? "Your profile" : "Account profile"}
        subtitle={user.role === "chef" ? "Keep your professional details accurate and current." : "Manage your administrator contact and account details."}
      />
      <div className="profile-grid">
        <article className="card profile-summary">
          <div className="avatar">
            {user.name
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)}
          </div>
          <h2>{user.name}</h2>
          <p>
            {user.role} · {user.cuisine || "ChefFlow team"}
          </p>
          <div className="verified-block">{user.email}</div>
        </article>
        <form
          className="card form-card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                repo.saveProfile({
                  name: String(f.get("name")).trim(),
                  phone: String(f.get("phone")),
                  cuisine: user.role === "chef" ? String(f.get("cuisine")) : user.cuisine,
                  experience: user.role === "chef" ? Number(f.get("experience")) : user.experience,
                  online: user.online,
                }),
              "Profile saved",
            );
          }}
        >
          <h2>Personal and work details</h2>
          <div className="form-grid">
            <Field label="Full name">
              <input
                name="name"
                defaultValue={user.name}
                required
                maxLength={120}
              />
            </Field>
            <Field label="Mobile number">
              <input
                name="phone"
                type="tel"
                defaultValue={user.phone}
                maxLength={30}
              />
            </Field>
            {user.role === "chef" && <><Field label="Work experience (years)">
              <input
                name="experience"
                type="number"
                min={0}
                max={80}
                defaultValue={user.experience}
                required
              />
            </Field>
            <Field label="Primary cuisine">
              <input
                name="cuisine"
                defaultValue={user.cuisine}
                maxLength={120}
              />
            </Field>
            </>}<Field label="Account role">
              <input value={user.role} disabled readOnly />
            </Field>
            <Field label="Email">
              <input value={user.email} disabled readOnly />
            </Field>
          </div>
          <div className="save-row">
            <button className="accept btn" disabled={busy}>
              Save changes
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Support({
  data,
  manager,
  run,
  busy,
}: {
  data: Data;
  manager: boolean;
  run: Run;
  busy: boolean;
}) {
  return (
    <>
      <Heading
        title={manager ? "Support tickets" : "Support & help"}
        subtitle="Report an issue and follow its progress."
      />
      <div className="content-grid">
        <form
          className="card form-card"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            if (
              await run(
                () =>
                  repo.createTicket(
                    String(f.get("subject")).trim(),
                    String(f.get("message")).trim(),
                  ),
                "Support ticket saved",
              )
            )
              form.reset();
          }}
        >
          <h2>Raise a support ticket</h2>
          <div className="login-fields">
            <Field label="Subject">
              <input name="subject" required maxLength={160} />
            </Field>
            <Field label="Describe the issue">
              <textarea name="message" required maxLength={4000} rows={5} />
            </Field>
          </div>
          <button className="accept btn" disabled={busy}>
            Submit ticket
          </button>
        </form>
        <article className="card section-card">
          <h2>Quick answers</h2>
          {[
            [
              "How is overtime calculated?",
              "Time beyond scheduled checkout is rounded up to a whole minute and charged at the booking's hourly overtime rate.",
            ],
            [
              "Which kitchen photos are required?",
              "Entry, kitchen before cooking, preparation, and kitchen after cooking. Entry and before photos are needed to check in; all four are required to complete.",
            ],
            [
              "Who can change roles?",
              "Administrators can assign chef, manager and administrator roles from Team & roles.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </article>
      </div>
      <article className="card section-card section-gap">
        <h2>{manager ? "Team tickets" : "Your tickets"}</h2>
        {!data.tickets.length && (
          <Empty
            title="No support tickets"
            text="Submitted issues and their status will appear here."
          />
        )}
        {data.tickets.map((t) => (
          <div className="ticket" key={t.id}>
            <div>
              <b>{t.subject}</b>
              <p>{t.message}</p>
              <small className="muted">{date(t.created_at)}</small>
            </div>
            <span
              className={`status-pill ${t.status === "open" ? "requested" : "completed"}`}
            >
              {t.status}
            </span>
            {manager && t.status === "open" && (
              <button
                className="outline-btn"
                disabled={busy}
                onClick={() =>
                  run(() => repo.resolveTicket(t.id), "Ticket resolved")
                }
              >
                Resolve
              </button>
            )}
          </div>
        ))}
      </article>
    </>
  );
}

export default function ChefFlow({
  initialPage = "dashboard",
}: {
  initialPage?: Page;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>(initialPage);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [newBooking, setNewBooking] = useState(false);
  const [bell, setBell] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [now, setNow] = useState(0);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const reload = useCallback(async () => {
    try {
      const id = await repo.currentUser();
      setUserId(id);
      if (id) setData(await repo.loadData());
      else setData(null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load your workspace.",
      );
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      setNow(Date.now());
      void reload();
    }, 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const handleStorage = () => {
      void reload();
    };
    window.addEventListener("storage", handleStorage);
    const subscription = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => {
        void reload();
      }, 0);
    });
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener("storage", handleStorage);
      subscription?.data.subscription.unsubscribe();
    };
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const run: Run = async (operation, message) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
      await reload();
      notify(message);
      return true;
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
        true,
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const go = (next: Page) => {
    setMenuOpen(false);
    setPage(next);
    setServiceId(null);
    setBell(false);
    window.scrollTo(0, 0);
  };
  const open = (id: string) => {
    setServiceId(id);
    setPage("bookings");
    setBell(false);
    window.scrollTo(0, 0);
  };
  const user = data?.profiles.find((p) => p.id === userId);
  const manager = !!user && user.role !== "chef";
  const shownPage =
    manager && ["dashboard", "ratings"].includes(page) ? "analytics" :
    !manager && ["analytics", "staff"].includes(page)
      ? "dashboard"
      : user?.role !== "admin" && page === "staff"
        ? "analytics"
        : page;
  const service = data?.bookings.find((b) => b.id === serviceId);
  const alerts =
    data?.bookings.filter(
      (b) =>
        b.status === "requested" ||
        (b.status === "in_progress" && overtime(b, now).minutes > 0),
    ) ?? [];
  const toastElement = toast && (
    <div
      className={`toast show ${toast.error ? "error" : ""}`}
      role={toast.error ? "alert" : "status"}
    >
      {toast.text}
    </div>
  );
  if (!loaded)
    return (
      <div className="loading-screen">
        <ChefHat size={35} />
        <p>Getting your kitchen ready…</p>
      </div>
    );
  if (error)
    return (
      <div className="loading-screen">
        <ChefHat size={35} />
        <h2>Couldn’t load ChefFlow</h2>
        <p className="error-text">{error}</p>
        <button className="accept btn" onClick={reload}>
          Try again
        </button>
        <button
          className="outline-btn"
          onClick={() => run(repo.logout, "Signed out")}
        >
          Sign out
        </button>
        {toastElement}
      </div>
    );
  if (!userId)
    return (
      <>
        <Login onLogin={reload} notify={notify} />
        {toastElement}
      </>
    );
  if (!user || !data)
    return (
      <div className="loading-screen">
        <h2>Your profile isn’t ready</h2>
        <p>Apply the database migration before registering users.</p>
        <button
          className="outline-btn"
          onClick={() => run(repo.logout, "Signed out")}
        >
          Sign out
        </button>
      </div>
    );
  if (user.approval_status && user.approval_status !== "approved") return <div className="loading-screen"><ChefHat size={36}/><h2>{user.approval_status === "pending" ? "Waiting for admin approval" : "Registration not approved"}</h2><p>{user.approval_status === "pending" ? "Your registration is saved. An administrator must approve your account before you can access ChefFlow." : "Please contact your administrator to review your registration."}</p><p>{user.email}</p><button className="accept btn" disabled={busy} onClick={() => run(async () => {}, "Approval status refreshed")}>Check approval status</button><button className="outline-btn" disabled={busy} onClick={() => run(repo.logout, "Signed out")}>Sign out</button>{toastElement}</div>;
  const availabilityToggle = !manager && (
    <button
      className={`online-toggle ${user.online ? "" : "offline"}`}
      aria-pressed={user.online}
      disabled={busy}
      onClick={() =>
        run(
          () => repo.saveProfile({
            name: user.name,
            phone: user.phone,
            cuisine: user.cuisine,
            experience: user.experience,
            online: !user.online,
          }),
          user.online ? "You are now offline" : "You are now available",
        )
      }
    >
      <span className="switch"><i /></span>
      <span>{user.online ? "You're online" : "You're offline"}</span>
    </button>
  );
  const done = data.bookings.filter((b) => b.status === "completed");
  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <Brand subtitle={manager ? "TEAM WORKSPACE" : "CHEF PARTNER"} />
          <div className="nav-label">MAIN MENU</div>
          {(manager ? [{ id: "analytics", label: "Business overview", icon: BarChart3 }, { ...nav[1], label: "Manage bookings" }, { ...nav[2], label: "Service revenue" }, nav[4]] as const : nav.slice(0, 5)).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${shownPage === n.id || (shownPage === "calendar" && n.id === "bookings") ? "active" : ""}`}
              onClick={() => go(n.id as Page)}
            >
              <span className="nav-icon">
                <n.icon />
              </span>
              {n.label}
              {n.id === "bookings" && alerts.length > 0 && (
                <span className="nav-badge">{alerts.length}</span>
              )}
            </button>
          ))}
          {manager && (
            <>
              <div className="nav-label">ADMINISTRATION</div>
              {adminNav
                .filter((n) => n.id === "staff" && user.role === "admin")
                .map((n) => (
                  <button
                    key={n.id}
                    className={`nav-item ${shownPage === n.id ? "active" : ""}`}
                    onClick={() => go(n.id as Page)}
                  >
                    <span className="nav-icon">
                      <n.icon />
                    </span>
                    {n.label}
                  </button>
                ))}
            </>
          )}
          <div className="nav-label">ACCOUNT</div>
          {nav.slice(5).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${shownPage === n.id ? "active" : ""}`}
              onClick={() => go(n.id as Page)}
            >
              <span className="nav-icon">
                <n.icon />
              </span>
              {n.label}
            </button>
          ))}
          <div className="sidebar-foot">
            <div className="foot-profile">
              <div className="avatar">
                {user.name
                  .split(" ")
                  .map((s) => s[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div>
                {user.name}
                <span>
                  {user.role} · {repo.isDemo ? "Demo workspace" : "ChefFlow"}
                </span>
              </div>
            </div>
            <button
              className="signout"
              disabled={busy}
              onClick={() => run(repo.logout, "Signed out")}
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="crumb">
              ChefFlow /{" "}
              <b>
                {[...nav, ...adminNav].find((n) => n.id === shownPage)?.label ||
                  "Calendar"}
              </b>
            </div>
            <div className="top-actions">
              <button
                className="bell"
                aria-label="Refresh workspace"
                disabled={busy}
                onClick={() => run(async () => {}, "Workspace refreshed")}
              >
                <RefreshCw />
              </button>
              <div className="notif-wrapper">
                <button
                  className={`bell ${bell ? "active" : ""}`}
                  aria-label="Notifications"
                  aria-expanded={bell}
                  onClick={() => setBell(!bell)}
                >
                  <Bell />
                  {alerts.length > 0 && (
                    <span className="bell-badge">{alerts.length}</span>
                  )}
                </button>
                {bell && (
                  <div className="flow-notifications">
                    <h3>Notifications</h3>
                    {!alerts.length && (
                      <Empty
                        title="All caught up"
                        text="No pending booking requests or overtime alerts."
                      />
                    )}
                    {alerts.map((b) => (
                      <button key={b.id} onClick={() => open(b.id)}>
                        <b>
                          {b.status === "requested"
                            ? "New booking request"
                            : "Scheduled out time exceeded"}
                        </b>
                        <span>
                          {b.customer} ·{" "}
                          {b.status === "requested"
                            ? money(b.base_amount)
                            : `Additional ${money(overtime(b, now).amount)}`}
                        </span>
                        <small>View service →</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!manager && <div className="desktop-availability">{availabilityToggle}</div>}
                <button
                  className="mobile-menu-button outline-btn"
                  aria-label="All pages"
                  aria-haspopup="dialog"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  <Menu size={20} aria-hidden="true" />
                </button>
            </div>
          </header>
          {repo.isDemo && (
            <div className="demo-banner">
              <span>
                <b>Demo workspace</b> · Changes are saved in this browser.
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  repo.demoLogin(manager ? "chef" : "admin");
                  setServiceId(null);
                  setPage(manager ? "dashboard" : "analytics");
                  void reload();
                }}
              >
                Switch to {manager ? "chef" : "admin"}{" "}
                <ChevronRight size={13} />
              </button>
            </div>
          )}
          {service ? (
            <ServiceDetail
              manager={manager}
              key={service.id}
              booking={service}
              data={data}
              now={now}
              run={run}
              busy={busy}
              onBack={() => setServiceId(null)}
            />
          ) : (
            <>
              {shownPage === "dashboard" && (
                <Dashboard
                  data={data}
                  user={user}
                  now={now}
                  open={open}
                  go={go}
                  run={run}
                  busy={busy}
                />
              )}
              {shownPage === "bookings" && (
                <>
                  <Heading
                    title={manager ? "All bookings" : "My bookings"}
                    subtitle="Manage requests, timings, menus and kitchen updates."
                  >
                    <div className="heading-actions">
                      <button
                        className="outline-btn"
                        onClick={() => go("calendar")}
                      >
                        <CalendarDays size={14} /> Calendar view
                      </button>
                      {manager && (
                        <button
                          className="accept btn"
                          onClick={() => setNewBooking(true)}
                        >
                          <Plus size={14} /> Create booking
                        </button>
                      )}
                    </div>
                  </Heading>
                  <div className="filter-tabs">
                    {(
                      ["all", ...Object.keys(statusLabels)] as (
                        | Status
                        | "all"
                      )[]
                    ).map((s) => (
                      <button
                        className={filter === s ? "active" : ""}
                        key={s}
                        onClick={() => setFilter(s)}
                      >
                        {s === "all" ? "All" : statusLabels[s]}{" "}
                        {
                          data.bookings.filter(
                            (b) => s === "all" || b.status === s,
                          ).length
                        }
                      </button>
                    ))}
                  </div>
                  <input
                    className="search-input"
                    aria-label="Search bookings"
                    placeholder="Search customer, service or location…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {data.bookings
                    .filter(
                      (b) =>
                        (filter === "all" || b.status === filter) &&
                        `${b.customer} ${b.service} ${b.address}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .sort((a, b) =>
                      a.scheduled_start.localeCompare(b.scheduled_start),
                    )
                    .map((b) => (
                      <div key={b.id}>
                        <BookingRow b={b} onOpen={open} now={now} />
                        {manager &&
                          ["requested", "upcoming"].includes(b.status) && (
                            <button
                              className="text-button cancel-booking"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => repo.actOnBooking(b.id, "cancel"),
                                  "Booking cancelled",
                                )
                              }
                            >
                              Cancel {b.customer}’s booking
                            </button>
                          )}
                      </div>
                    ))}
                  {!data.bookings.some(
                    (b) =>
                      (filter === "all" || b.status === filter) &&
                      `${b.customer} ${b.service} ${b.address}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  ) && (
                    <Empty
                      title="No matching bookings"
                      text="Try another filter or search."
                    />
                  )}
                </>
              )}
              {shownPage === "calendar" && (
                <Calendar data={data} now={now} open={open} />
              )}
              {shownPage === "earnings" && (
                <>
                  <Heading
                    title={manager ? "Service revenue" : "Earnings"}
                    subtitle="Service income, recorded timings and additional charges."
                  >
                    <button
                      className="outline-btn"
                      onClick={() =>
                        exportBookings({ ...data, bookings: done })
                      }
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </Heading>
                  <div className="overview">
                    <Metric
                      label="COMPLETED SERVICES"
                      value={done.length}
                      icon={<CalendarDays />}
                    />
                    <Metric
                      label="BASE EARNINGS"
                      value={money(done.reduce((s, b) => s + b.base_amount, 0))}
                      icon={<IndianRupee />}
                    />
                    <Metric
                      label="OVERTIME EARNINGS"
                      value={money(
                        done.reduce((s, b) => s + b.overtime_amount, 0),
                      )}
                      icon={<Clock3 />}
                    />
                    <Metric
                      label="TOTAL EARNINGS"
                      value={money(
                        done.reduce(
                          (s, b) => s + b.base_amount + b.overtime_amount,
                          0,
                        ),
                      )}
                      icon={<WalletCards />}
                    />
                  </div>
                  <article className="card table-card">
                    <div className="card-head">
                      <div>
                        <h2 className="card-title">Service earnings record</h2>
                        <p className="card-sub">
                          Recorded service values. Payment collection and bank
                          payouts are outside this prototype.
                        </p>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>BOOKING</th>
                          <th>CHECK-IN / OUT</th>
                          <th>BASE FEE</th>
                          <th>ADDITIONAL</th>
                          <th>TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {done.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => open(b.id)}
                              >
                                {b.customer}
                              </button>
                              <small>{date(b.actual_out!)}</small>
                            </td>
                            <td>
                              {time(b.actual_in)}
                              <small>{time(b.actual_out)}</small>
                            </td>
                            <td>{money(b.base_amount)}</td>
                            <td className="warning-text">
                              {money(b.overtime_amount)}
                              <small>{overtime(b).minutes} minutes</small>
                            </td>
                            <td className="success">
                              {money(b.base_amount + b.overtime_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!done.length && (
                      <Empty
                        title="No earnings yet"
                        text="Complete a service to record its final fee and overtime."
                      />
                    )}
                  </article>
                </>
              )}
              {shownPage === "ratings" && (
                <>
                  <Heading
                    title="Ratings & performance"
                    subtitle="Feedback from your completed dining experiences."
                  />
                  <article className="card section-card">
                    <h2>Customer reviews</h2>
                    {!data.reviews.length && (
                      <Empty
                        title="No reviews yet"
                        text="Customer feedback will appear here after services are reviewed."
                      />
                    )}
                    {data.reviews.map((r) => (
                      <div className="review" key={r.id}>
                        <div className="avatar">{r.customer[0]}</div>
                        <div>
                          <b>{r.customer}</b>
                          <p>{r.comment}</p>
                        </div>
                        <span
                          className="stars"
                          aria-label={`${r.rating} out of 5`}
                        >
                          {"★".repeat(r.rating)}
                        </span>
                      </div>
                    ))}
                  </article>
                </>
              )}
              {shownPage === "profile" && (
                <ProfilePage key={user.id} user={user} busy={busy} run={run} />
              )}
              {shownPage === "support" && (
                <Support data={data} manager={manager} busy={busy} run={run} />
              )}
              {shownPage === "dishes" && (
                <Dishes data={data} busy={busy} run={run} editable={manager} />
              )}
              {shownPage === "analytics" && manager && (
                <><div className="admin-quick-actions"><button className="accept btn" onClick={() => setNewBooking(true)}><Plus size={15}/> Create booking</button>{user.role === "admin" && <button className="outline-btn" onClick={() => go("staff")}>Review members ({data.profiles.filter(p => p.approval_status === "pending").length} pending)</button>}<button className="outline-btn" onClick={() => go("bookings")}>Manage all bookings</button></div><Analytics data={data} now={now} /></>
              )}
              {shownPage === "staff" && user.role === "admin" && (
                <Staff data={data} userId={user.id} busy={busy} run={run} />
              )}
            </>
          )}
          <footer className="workspace-footer">
            ChefFlow · Made for memorable meals{" "}
            <span>All service timings in IST</span>
            <button
              className="mobile-signout"
              onClick={() => run(repo.logout, "Signed out")}
            >
              Sign out
            </button>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {(manager
          ? [
              adminNav[0],
              nav[1],
              nav[2],
              ...(user.role === "admin" ? [adminNav[1]] : [nav[4]]),
              nav[5],
            ]
          : [nav[0], nav[1], nav[2], nav[4], nav[5]]
        ).map((n) => (
          <button
            key={n.id}
            className={shownPage === n.id ? "active" : ""}
            onClick={() => go(n.id as Page)}
          >
            <n.icon />
            {n.label === "Dashboard"
              ? "Home"
              : n.label === "Team & roles"
                ? "Team"
                : n.label}
          </button>
        ))}
      </nav>
      {menuOpen && (
        <Modal title={manager ? "Administration" : "Your workspace"} onClose={() => setMenuOpen(false)}>
          {!manager && <div className="menu-availability">{availabilityToggle}</div>}
          <div className="all-pages">
            {(manager ? [{id:"analytics",label:"Business overview"},{id:"bookings",label:"Manage bookings"},{id:"earnings",label:"Service revenue"},{id:"dishes",label:"Dish library"},...(user.role === "admin" ? [{id:"staff",label:"Team & approvals"}] : []),{id:"calendar",label:"Calendar"},{id:"profile",label:"Account profile"},{id:"support",label:"Support tickets"}] : [...nav,{id:"calendar",label:"Calendar"}]).map(n => <button className="nav-item" key={n.id} onClick={() => go(n.id as Page)}>{n.label}</button>)}
          </div>
          <div className="save-row">
            <button
              className="outline-btn"
              disabled={busy}
              onClick={async () => {
                if (await run(repo.logout, "Signed out")) setMenuOpen(false);
              }}
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </Modal>
      )}
      {newBooking && (
        <NewBookingModal
          data={data}
          busy={busy}
          run={run}
          onClose={() => setNewBooking(false)}
        />
      )}
      {toastElement}
    </>
  );
}
