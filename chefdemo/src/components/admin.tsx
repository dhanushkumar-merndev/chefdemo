"use client";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Clock3,
  IndianRupee,
  Plus,
  Download,
  Users,
} from "lucide-react";
import {
  Data,
  Dish,
  Profile,
  Role,
  Status,
  csvCell,
  dayKey,
  money,
  overtime,
  statusLabels,
} from "@/lib/domain";
import * as repo from "@/lib/repository";
import { AreaFields, Empty, Field, Heading, Modal, Run } from "./ui";

export function exportBookings(data: Data) {
  const rows = [
    [
      "Customer",
      "Chef",
      "Status",
      "Scheduled in",
      "Scheduled out",
      "Check-in",
      "Check-out",
      "Base INR",
      "Overtime INR",
      "Total INR",
    ],
    ...data.bookings.map((b) => [
      b.customer,
      data.profiles.find((p) => p.id === b.chef_id)?.name,
      b.status,
      b.scheduled_start,
      b.scheduled_end,
      b.actual_in,
      b.actual_out,
      b.base_amount,
      b.overtime_amount,
      b.base_amount + b.overtime_amount,
    ]),
  ];
  const blob = new Blob(
    ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chefflow-bookings.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric">
      <div className="metric-icon">{icon}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </article>
  );
}
export function Analytics({ data, now }: { data: Data; now: number }) {
  const [range, setRange] = useState("30");
  const filtered = data.bookings.filter(
    (b) =>
      range === "all" ||
      Date.parse(b.scheduled_start) >= now - Number(range) * 86400000,
  );
  const completed = filtered.filter((b) => b.status === "completed");
  const revenue = completed.reduce(
    (sum, b) => sum + b.base_amount + b.overtime_amount,
    0,
  );
  const ot = completed.reduce((sum, b) => sum + b.overtime_amount, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const stamp = now - (6 - i) * 86400000;
    return {
      label: new Date(stamp).toLocaleDateString("en-IN", {
        weekday: "short",
        timeZone: "Asia/Kolkata",
      }),
      value: completed
        .filter((b) => dayKey(b.actual_out!) === dayKey(stamp))
        .reduce((s, b) => s + b.base_amount + b.overtime_amount, 0),
    };
  });
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <>
      <Heading
        title="Business overview"
        subtitle="Bookings, chef activity and service earnings in one place."
      >
        <select
          aria-label="Analytics period"
          className="compact-select"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="7">Last 7 days + upcoming</option>
          <option value="30">Last 30 days + upcoming</option>
          <option value="all">All time</option>
        </select>
      </Heading>
      <div className="overview">
        <Metric
          label="TOTAL BOOKINGS"
          value={filtered.length}
          icon={<CalendarDays />}
        />
        <Metric
          label="COMPLETED SERVICE VALUE"
          value={money(revenue)}
          icon={<IndianRupee />}
        />
        <Metric label="OVERTIME EARNINGS" value={money(ot)} icon={<Clock3 />} />
        <Metric
          label="ACTIVE CHEFS"
          value={
            data.profiles.filter((p) => p.role === "chef" && p.online).length
          }
          icon={<Users />}
        />
      </div>
      <div className="content-grid">
        <article className="card section-card">
          <div className="section-title">
            <BarChart3 size={18} />
            <h2>Completed service earnings</h2>
          </div>
          <p className="muted small-copy">
            Last 7 days · INR · based on checkout date
          </p>
          <div className="chart" aria-label="Daily completed service earnings">
            {days.map((d, i) => (
              <div className="chart-column" key={i}>
                <span>{money(d.value)}</span>
                <div className="chart-track">
                  <div
                    style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
                  />
                </div>
                <b>{d.label}</b>
              </div>
            ))}
          </div>
        </article>
        <article className="card section-card">
          <h2>Booking status</h2>
          <div className="status-breakdown">
            {(Object.keys(statusLabels) as Status[]).map((s) => (
              <div key={s}>
                <span className={`status-pill ${s}`}>{statusLabels[s]}</span>
                <b>{filtered.filter((b) => b.status === s).length}</b>
              </div>
            ))}
          </div>
          <p className="small-copy muted">
            {
              filtered.filter(
                (b) =>
                  b.status === "in_progress" && overtime(b, now).minutes > 0,
              ).length
            }{" "}
            active services have exceeded their scheduled out time.
          </p>
        </article>
      </div>
      <article className="card table-card section-gap">
        <div className="card-head">
          <div>
            <h2 className="card-title">Chef performance</h2>
            <p className="card-sub">Completed services and recorded overtime</p>
          </div>
          <button
            className="text-button"
            onClick={() => exportBookings({ ...data, bookings: filtered })}
          >
            <Download size={14} /> EXPORT CSV
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>CHEF</th>
              <th>COMPLETED</th>
              <th>SERVICE VALUE</th>
              <th>OVERTIME</th>
              <th>PHOTO COMPLETION</th>
            </tr>
          </thead>
          <tbody>
            {data.profiles
              .filter((p) => p.role === "chef" && (!p.approval_status || p.approval_status === "approved"))
              .map((p) => {
                const bs = completed.filter((b) => b.chef_id === p.id);
                const photoComplete = bs.filter(
                  (b) =>
                    data.photos.filter((photo) => photo.booking_id === b.id)
                      .length === 4,
                ).length;
                return (
                  <tr key={p.id}>
                    <td data-label="Chef">
                      <b>{p.name}</b>
                      <small>{p.online ? "Available" : "Offline"}</small>
                    </td>
                    <td data-label="Completed">{bs.length}</td>
                    <td data-label="Service value">
                      {money(
                        bs.reduce(
                          (s, b) => s + b.base_amount + b.overtime_amount,
                          0,
                        ),
                      )}
                    </td>
                    <td data-label="Overtime">
                      {money(bs.reduce((s, b) => s + b.overtime_amount, 0))}
                    </td>
                    <td data-label="Photos">
                      {photoComplete}/{bs.length} services
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </article>
    </>
  );
}
export function Staff({
  data,
  userId,
  busy,
  run,
}: {
  data: Data;
  userId: string;
  busy: boolean;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Heading
        title="Team & roles"
        subtitle="Manage who can access ChefFlow and what they can do."
      >
        <button className="accept btn" onClick={() => setOpen(true)}>
          <Plus size={15} /> Add staff
        </button>
      </Heading>
      <div className="role-cards">
        {[
          [
            "Administrator",
            "Manage roles, staff, bookings, dishes and analytics.",
          ],
          [
            "Manager",
            "Manage bookings, dishes, photo reviews, support and analytics.",
          ],
          [
            "Chef",
            "Manage assigned services, timings, menus and kitchen photos.",
          ],
        ].map(([title, text]) => (
          <article className="card section-card" key={title}>
            <h2>{title}</h2>
            <p className="small-copy muted">{text}</p>
          </article>
        ))}
      </div>
      <article className="card table-card section-gap">
        <table>
          <thead>
            <tr>
              <th>STAFF MEMBER</th>
              <th>EMAIL</th>
              <th>ROLE</th>
              <th>APPROVAL</th>
              <th>AVAILABILITY</th>
            </tr>
          </thead>
          <tbody>
            {data.profiles.map((p) => (
              <tr key={p.id}>
                <td data-label="Staff member">
                  <b>{p.name}</b>
                  {p.id === userId && <small>Your account</small>}
                </td>
                <td data-label="Email">{p.email}</td>
                <td data-label="Role">
                  <select
                    aria-label={`Role for ${p.name}`}
                    className="compact-select"
                    value={p.role}
                    disabled={busy || p.id === userId}
                    onChange={(e) =>
                      run(
                        () => repo.setRole(p.id, e.target.value as Role),
                        "Role updated",
                      )
                    }
                  >
                    <option value="chef">Chef</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Administrator</option>
                  </select>
                </td>
                <td data-label="Approval"><span className="status-pill">{p.approval_status || "approved"}</span>{p.id !== userId && <div className="action-row">{p.approval_status !== "approved" && <button className="accept" disabled={busy} onClick={() => run(() => repo.reviewMember(p.id, "approved"), "Member approved")}>Approve</button>}{p.approval_status !== "rejected" && <button className="reject" disabled={busy} onClick={() => run(() => repo.reviewMember(p.id, "rejected"), "Member rejected")}>Reject</button>}</div>}</td>
                <td data-label="Availability">
                  <span
                    className={`status-pill ${p.online ? "completed" : "cancelled"}`}
                  >
                    {p.online ? "Online" : "Offline"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      {data.staff_access.length > 0 && (
        <article className="card section-card section-gap">
          <h2>Awaiting registration</h2>
          {data.staff_access.map((p) => (
            <div className="bill-line" key={p.id}>
              <span>
                {p.name}
                <small className="block muted">{p.email}</small>
              </span>
              <span className="tag">{p.role}</span>
            </div>
          ))}
          <p className="muted small-copy">
            These people receive their assigned role and await approval when they register with the
            authorized email.
          </p>
        </article>
      )}
      {open && (
        <Modal title="Add staff member" onClose={() => setOpen(false)}>
          <p className="muted small-copy">
            {repo.isDemo
              ? "Create a staff profile in this prototype."
              : "Authorize an email address and role. The staff member can then register on the login page. No email is sent."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await run(
                  () =>
                    repo.authorizeStaff(
                      String(f.get("name")),
                      String(f.get("email")),
                      f.get("role") as Role,
                    ),
                  "Staff member added",
                )
              )
                setOpen(false);
            }}
          >
            <div className="form-grid">
              <Field label="Full name">
                <input name="name" required maxLength={120} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required />
              </Field>
              <Field label="Role" full>
                <select name="role">
                  <option value="chef">Chef</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Administrator</option>
                </select>
              </Field>
            </div>
            <div className="save-row">
              <button className="accept btn" disabled={busy}>
                Add staff member
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Dishes({
  data,
  busy,
  run,
  editable,
}: {
  data: Data;
  busy: boolean;
  run: Run;
  editable: boolean;
}) {
  const [editing, setEditing] = useState<Dish | "new" | null>(null);
  const [search, setSearch] = useState("");
  const list = data.dishes.filter((d) =>
    `${d.name} ${d.cuisine}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Dish library"
        subtitle="The menus behind memorable dining experiences."
      >
        {editable && (
          <button className="accept btn" onClick={() => setEditing("new")}>
            <Plus size={15} /> Add dish
          </button>
        )}
      </Heading>
      <input
        className="search-input"
        aria-label="Search dish library"
        placeholder="Search dishes or cuisines…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="dish-library">
        {list.map((d) => (
          <article className="card section-card" key={d.id}>
            <div className="section-title">
              <i className={`food-dot ${d.vegetarian ? "veg" : "nonveg"}`} />
              <span className="tag">{d.cuisine}</span>
              {!d.active && <span className="tag">Archived</span>}
            </div>
            <h2>{d.name}</h2>
            <p className="small-copy muted">
              {d.vegetarian ? "Vegetarian" : "Non-vegetarian"}
            </p>
            {editable && (
              <button className="outline-btn" onClick={() => setEditing(d)}>
                Edit dish
              </button>
            )}
          </article>
        ))}
      </div>
      {!list.length && (
        <Empty
          title="No dishes found"
          text="Try another search or add your first dish."
        />
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Add dish" : "Edit dish"}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const dish: Dish = {
                id: editing === "new" ? crypto.randomUUID() : editing.id,
                name: String(f.get("name")).trim(),
                cuisine: String(f.get("cuisine")).trim(),
                vegetarian: f.get("vegetarian") === "on",
                active: f.get("active") === "on",
              };
              if (await run(() => repo.saveDish(dish), "Dish saved"))
                setEditing(null);
            }}
          >
            <div className="form-grid">
              <Field label="Dish name">
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editing === "new" ? "" : editing.name}
                />
              </Field>
              <Field label="Cuisine">
                <input
                  name="cuisine"
                  required
                  maxLength={80}
                  defaultValue={editing === "new" ? "" : editing.cuisine}
                />
              </Field>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="vegetarian"
                  defaultChecked={editing === "new" || editing.vegetarian}
                />
                Vegetarian
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing === "new" || editing.active}
                />
                Available for selection
              </label>
            </div>
            <div className="save-row">
              <button className="accept btn" disabled={busy}>
                Save dish
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function NewBookingModal({
  data,
  run,
  busy,
  onClose,
}: {
  data: Data;
  run: Run;
  busy: boolean;
  onClose: () => void;
}) {
  const [region, setRegion] = useState("");
  const [location, setLocation] = useState("");
  const chefs = data.profiles.filter(
    (p) => p.role === "chef" && (!p.approval_status || p.approval_status === "approved"),
  );
  const nearby = chefs.filter((p) => p.location === location && location);
  const others = chefs.filter((p) => !nearby.includes(p));
  const chefOption = (p: Profile, outside: boolean) => (
    <label className="chef-picker-option" key={p.id}>
      <input type="radio" name="chef" value={p.id} required />
      <span>
        <b>{p.name}</b>
        <small>{p.email}</small>
        <small>
          {p.location ? `${p.location}, ${p.region}` : "No location set"}
          {outside ? " · outside this area" : ""}
          {p.online ? " · Online" : " · Offline"}
          {p.cuisine ? ` · ${p.cuisine}` : ""}
        </small>
      </span>
    </label>
  );
  return (
    <Modal title="Create booking" onClose={onClose}>
      <p className="small-copy muted">
        Assign a chef, timings and fees. The chef will receive a booking
        request. All times are in IST.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (key: string) => String(f.get(key) ?? "");
          if (
            await run(
              () =>
                repo.createBooking({
                  chef_id: get("chef"),
                  customer: get("customer"),
                  service: get("service"),
                  address: get("address"),
                  region,
                  location,
                  guests: Number(get("guests")),
                  scheduled_start: new Date(
                    get("start") + ":00+05:30",
                  ).toISOString(),
                  scheduled_end: new Date(
                    get("end") + ":00+05:30",
                  ).toISOString(),
                  base_amount: Number(get("base")),
                  overtime_rate: Number(get("rate")),
                  dish_ids: f.getAll("dishes").map(String),
                  notes: get("notes"),
                }),
              "Booking created and assigned",
            )
          )
            onClose();
        }}
      >
        <div className="form-grid">
          <Field label="Customer name">
            <input name="customer" required maxLength={120} />
          </Field>
          <Field label="Service">
            <input
              name="service"
              required
              placeholder="Private dinner"
              maxLength={160}
            />
          </Field>
          <AreaFields
            areas={data.service_areas}
            region={region}
            location={location}
            onRegion={setRegion}
            onLocation={setLocation}
            required
            regionLabel="Service region"
            locationLabel="Service location"
          />
          <fieldset className="chef-picker">
            <legend>Assigned chef</legend>
            <div className="chef-picker-options">
              {!location && (
                <p className="muted small-copy">
                  Select a region and location to see the chefs who work there.
                </p>
              )}
              {location && nearby.length > 0 && (
                <>
                  <p className="picker-group">In {location}</p>
                  {nearby.map((p) => chefOption(p, false))}
                </>
              )}
              {location && nearby.length === 0 && (
                <p className="muted small-copy">
                  No chef works in {location} yet. You can still assign a chef
                  from another area.
                </p>
              )}
              {location && others.length > 0 && (
                <>
                  <p className="picker-group">Other areas</p>
                  {others.map((p) => chefOption(p, true))}
                </>
              )}
              {!chefs.length && (
                <p className="muted small-copy">
                  No approved chefs yet. Approve a chef in Team &amp; roles
                  before creating a booking.
                </p>
              )}
            </div>
          </fieldset>
          <Field label="Guests">
            <input
              name="guests"
              type="number"
              min={1}
              max={500}
              required
              defaultValue={10}
            />
          </Field>
          <Field label="Scheduled in (IST)">
            <input name="start" type="datetime-local" required />
          </Field>
          <Field label="Scheduled out (IST)">
            <input name="end" type="datetime-local" required />
          </Field>
          <Field label="Base service fee (₹)">
            <input
              name="base"
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              required
              defaultValue={2400}
            />
          </Field>
          <Field label="Overtime rate (₹/hour)">
            <input
              name="rate"
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              required
              defaultValue={300}
            />
          </Field>
          <Field label="Kitchen address" full>
            <input name="address" required maxLength={500} />
          </Field>
          <Field label="Customer notes" full>
            <textarea name="notes" rows={2} maxLength={2000} />
          </Field>
        </div>
        <p className="small-copy">Suggested dishes</p>
        <div className="dish-options">
          {data.dishes
            .filter((d) => d.active)
            .map((d) => (
              <label className="checkbox-label" key={d.id}>
                <input type="checkbox" name="dishes" value={d.id} />
                {d.name}
              </label>
            ))}
        </div>
        <div className="save-row">
          <button className="accept btn" disabled={busy}>
            Create booking
          </button>
        </div>
      </form>
    </Modal>
  );
}
