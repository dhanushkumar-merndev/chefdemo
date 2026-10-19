"use client";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gavel,
  MapPin,
  Plus,
  Timer,
} from "lucide-react";
import {
  BidRow,
  DEPOSIT_PERCENT,
  Data,
  OrderRow,
  OrderStatus,
  Paged,
  bidStatusLabels,
  chefTypeLabel,
  date,
  depositFor,
  money,
  orderStatusLabels,
  time,
} from "@/lib/domain";
import * as repo from "@/lib/repository";
import { AreaFields, Empty, Field, Heading, Modal, Run } from "./ui";

const PAGE_SIZE = 10;
export type OrderTab = OrderStatus | "all";
export type OrderFocus = { tab: OrderTab; id: string | null };

/** One page of orders, fetched again whenever `version` changes (every
 *  workspace reload, so after each action). */
function useOrders(status: OrderTab, offset: number, limit: number, version: number) {
  const [result, setResult] = useState<Paged<OrderRow> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    repo.listOrders(status, limit, offset).then(
      (r) => {
        if (!current) return;
        setResult(r);
        setError("");
      },
      (e) => {
        if (current)
          setError(
            `${e instanceof Error ? e.message : "Could not load orders"}. Check that the Supabase migration has been applied.`,
          );
      },
    );
    return () => {
      current = false;
    };
  }, [status, offset, limit, version]);
  return { result, error };
}

/** "Bids close in 2 d 4 h", or "Bidding closed" once the deadline passes. */
export function closesIn(deadline: string, now: number) {
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return "Bidding closed";
  const mins = Math.ceil(ms / 60_000);
  const d = Math.floor(mins / 1440),
    h = Math.floor((mins % 1440) / 60),
    m = mins % 60;
  return `Bids close in ${d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`}`;
}

export function Pager({
  offset,
  total,
  limit,
  onOffset,
}: {
  offset: number;
  total: number;
  limit: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="pager">
      <button
        className="outline-btn"
        aria-label="Previous page"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        <ChevronLeft size={14} />
      </button>
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button
        className="outline-btn"
        aria-label="Next page"
        disabled={offset + limit >= total}
        onClick={() => onOffset(offset + limit)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function OrderCard({
  o,
  manager,
  now,
  selected,
  onToggle,
}: {
  o: OrderRow;
  manager: boolean;
  now: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const d = new Date(o.scheduled_start);
  const part = (opt: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString("en-IN", { ...opt, timeZone: "Asia/Kolkata" });
  return (
    <button
      className={`booking-row card order-row ${selected ? "selected" : ""}`}
      aria-expanded={selected}
      onClick={onToggle}
    >
      <div className="booking-date">
        {part({ month: "short" }).toUpperCase()}
        <b>{part({ day: "2-digit" })}</b>
        {part({ weekday: "short" }).toUpperCase()}
      </div>
      <div className="booking-main">
        <h3>{o.customer}</h3>
        <p>
          <span className="booking-code">{o.code}</span> · {o.service} ·{" "}
          {o.guests} guests
        </p>
        <p className="booking-time">
          <MapPin size={12} />
          {o.location}, {o.region}
        </p>
        <p className="booking-time">
          <Clock3 size={12} />
          {time(o.scheduled_start)} – {time(o.scheduled_end)} IST
        </p>
        <div className="booking-tags">
          <span className={`status-pill order-${o.status}`}>
            {orderStatusLabels[o.status]}
          </span>
          {o.status === "open" && (
            <span className="status-pill">
              <Timer size={10} /> {closesIn(o.bid_deadline, now)}
            </span>
          )}
          {o.my_bid && (
            <span className={`status-pill bid-${o.my_bid.status}`}>
              {bidStatusLabels[o.my_bid.status]}
            </span>
          )}
        </div>
      </div>
      <div className="booking-side">
        {manager ? (
          o.winning_amount != null ? (
            <>
              <b>{money(o.winning_amount)}</b>
              <span>Won by {o.winner_name}</span>
            </>
          ) : (
            <>
              <b>{o.lowest_bid != null ? money(o.lowest_bid) : "—"}</b>
              <span>
                {o.bid_count ?? 0} {o.bid_count === 1 ? "bid" : "bids"} ·
                lowest
              </span>
            </>
          )
        ) : o.my_bid ? (
          <>
            <b>{money(o.my_bid.amount)}</b>
            <span>Your bid</span>
          </>
        ) : (
          <>
            <b>{o.max_budget != null ? money(o.max_budget) : "Open"}</b>
            <span>{o.max_budget != null ? "Client budget" : "No budget set"}</span>
          </>
        )}
      </div>
      <ChevronRight size={16} />
    </button>
  );
}

function StaffActions({
  o,
  busy,
  run,
  version,
  openBooking,
}: {
  o: OrderRow;
  busy: boolean;
  run: Run;
  version: number;
  openBooking: (id: string) => void;
}) {
  const [bids, setBids] = useState<BidRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    repo.orderBids(o.id).then(
      (rows) => current && setBids(rows),
      (e) => current && setError(e instanceof Error ? e.message : "Could not load bids."),
    );
    return () => {
      current = false;
    };
  }, [o.id, version]);
  const winning = o.winning_amount ?? 0;
  const deposit = o.status === "confirmed" ? o.deposit_amount : depositFor(winning);
  return (
    <>
      <h3 className="order-subtitle">Chef bids</h3>
      {error && <p className="error-text">{error}</p>}
      {bids && !bids.length && (
        <p className="muted small-copy">
          No bids yet. Chefs who serve {o.location} and are free at this time
          can bid until the deadline.
        </p>
      )}
      <ol className="bid-list">
        {bids?.map((b) => (
          <li key={b.id} className={b.status === "won" ? "winner" : ""}>
            <span>
              <b>{b.chef_name}</b>
              <small>
                {chefTypeLabel(b.chef_type)} · {b.experience} yrs ·{" "}
                {b.chef_location}, {b.chef_region}
              </small>
              {b.message && <small>“{b.message}”</small>}
            </span>
            <span className="bid-amount">
              <b>{money(b.amount)}</b>
              <span className={`status-pill bid-${b.status}`}>
                {bidStatusLabels[b.status]}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {(o.status === "awarded" || o.status === "confirmed") && (
        <div className="deposit-box">
          <div className="bill-line">
            <span>Winning bid · {o.winner_name}</span>
            <b>{money(winning)}</b>
          </div>
          <div className="bill-line">
            <span>
              Client deposit ({DEPOSIT_PERCENT}%)
              {o.status === "confirmed" ? " · paid" : " · due now"}
            </span>
            <b>{money(deposit)}</b>
          </div>
          <div className="bill-line">
            <span>Balance due after service</span>
            <b>{money(winning - deposit)}</b>
          </div>
          {o.status === "confirmed" && (
            <p className="muted small-copy">
              Simulated payment {o.deposit_ref} recorded{" "}
              {o.deposit_paid_at &&
                `${date(o.deposit_paid_at)}, ${time(o.deposit_paid_at)} IST`}
              . {o.winner_name} has been assigned.
            </p>
          )}
        </div>
      )}
      <div className="action-row order-actions">
        {o.status === "open" && (
          <button
            className="accept btn"
            disabled={busy}
            onClick={() => run(() => repo.closeBidding(o.id), "Bidding closed")}
          >
            <Gavel size={14} /> Close bidding now
          </button>
        )}
        {o.status === "awarded" && (
          <button
            className="accept btn"
            disabled={busy}
            onClick={() =>
              run(
                () => repo.payDeposit(o.id),
                `Deposit recorded · ${o.winner_name} assigned`,
              )
            }
          >
            Record {DEPOSIT_PERCENT}% deposit (simulated)
          </button>
        )}
        {o.status === "confirmed" && o.booking_id && (
          <button className="accept btn" onClick={() => openBooking(o.booking_id!)}>
            Open booking <ChevronRight size={14} />
          </button>
        )}
        {["open", "awarded", "unfilled"].includes(o.status) && (
          <button
            className="text-button cancel-booking"
            disabled={busy}
            onClick={() => run(() => repo.cancelOrder(o.id), "Order cancelled")}
          >
            Cancel order {o.code}
          </button>
        )}
      </div>
    </>
  );
}

function ChefBid({
  o,
  now,
  busy,
  run,
  openBooking,
}: {
  o: OrderRow;
  now: number;
  busy: boolean;
  run: Run;
  openBooking: (id: string) => void;
}) {
  const mine = o.my_bid;
  const biddable = o.status === "open" && Date.parse(o.bid_deadline) > now;
  if (mine?.status === "won" && o.status === "awarded")
    return (
      <p className="order-note success">
        You won this order at {money(mine.amount)}. It is assigned to you as
        soon as the client pays the {DEPOSIT_PERCENT}% deposit.
      </p>
    );
  if (mine?.status === "won" && o.status === "confirmed")
    return (
      <div className="order-note success">
        <p>
          Deposit paid. This service is assigned to you at{" "}
          {money(mine.amount)}.
        </p>
        {o.booking_id && (
          <button className="accept btn" onClick={() => openBooking(o.booking_id!)}>
            Open booking <ChevronRight size={14} />
          </button>
        )}
      </div>
    );
  if (!biddable)
    return (
      <p className="order-note muted">
        {mine?.status === "lost"
          ? "Another chef was selected for this order."
          : o.status === "cancelled"
            ? "This order was cancelled."
            : "Bidding has closed for this order."}
      </p>
    );
  return (
    <form
      className="bid-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(
          () =>
            repo.placeBid(o.id, Number(f.get("amount")), String(f.get("message") ?? "")),
          mine?.status === "active" ? "Bid updated" : "Bid placed",
        );
      }}
    >
      <div className="form-grid">
        <Field label="Your price for this service (₹)">
          <input
            name="amount"
            type="number"
            min={1}
            max={o.max_budget ?? 1000000}
            step="0.01"
            required
            defaultValue={mine?.status === "active" ? mine.amount : undefined}
          />
        </Field>
        <Field label="Note to the team (optional)">
          <input
            name="message"
            maxLength={500}
            defaultValue={mine?.message ?? ""}
          />
        </Field>
      </div>
      <p className="muted small-copy">
        Bids are sealed: other chefs cannot see your price. The lowest bid wins
        when bidding closes; equal bids go to whoever bid first.
      </p>
      <div className="action-row order-actions">
        <button className="accept btn" disabled={busy}>
          {mine?.status === "active" ? "Update bid" : "Place bid"}
        </button>
        {mine?.status === "active" && (
          <button
            type="button"
            className="text-button cancel-booking"
            disabled={busy}
            onClick={() => run(() => repo.withdrawBid(o.id), "Bid withdrawn")}
          >
            Withdraw bid
          </button>
        )}
      </div>
    </form>
  );
}

function OrderDetail(props: {
  o: OrderRow;
  data: Data;
  manager: boolean;
  now: number;
  busy: boolean;
  run: Run;
  version: number;
  openBooking: (id: string) => void;
}) {
  const { o, data, manager } = props;
  const dishes = data.dishes
    .filter((d) => o.dish_ids.includes(d.id))
    .map((d) => d.name)
    .join(", ");
  return (
    <article className="card section-card order-detail">
      <div className="bill-line">
        <span>Bidding deadline</span>
        <b>
          {date(o.bid_deadline)}, {time(o.bid_deadline)} IST
        </b>
      </div>
      <div className="bill-line">
        <span>Kitchen address</span>
        <b>{o.address ?? "Shared with the chef who wins"}</b>
      </div>
      <div className="bill-line">
        <span>Overtime rate</span>
        <b>{money(o.overtime_rate)}/hr</b>
      </div>
      {o.max_budget != null && (
        <div className="bill-line">
          <span>Client budget</span>
          <b>{money(o.max_budget)}</b>
        </div>
      )}
      {dishes && (
        <div className="bill-line">
          <span>Suggested dishes</span>
          <b>{dishes}</b>
        </div>
      )}
      {o.notes && <p className="small-copy order-notes">{o.notes}</p>}
      {manager ? <StaffActions {...props} /> : <ChefBid {...props} />}
    </article>
  );
}

const staffTabs: [OrderTab, string][] = [
  ["open", "Open for bids"],
  ["awarded", "Awaiting deposit"],
  ["confirmed", "Confirmed"],
  ["unfilled", "No bids"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
];
const chefTabs: [OrderTab, string][] = [
  ["open", "Open near you"],
  ["awarded", "Awaiting deposit"],
  ["confirmed", "Confirmed"],
  ["all", "All my orders"],
];

export function OrdersPage({
  data,
  manager,
  now,
  version,
  busy,
  run,
  focus,
  openBooking,
  onNewOrder,
}: {
  data: Data;
  manager: boolean;
  now: number;
  version: number;
  busy: boolean;
  run: Run;
  focus: OrderFocus | null;
  openBooking: (id: string) => void;
  onNewOrder: () => void;
}) {
  const [tab, setTab] = useState<OrderTab>(focus?.tab ?? "open");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(focus?.id ?? null);
  const { result, error } = useOrders(tab, offset, PAGE_SIZE, version);
  return (
    <>
      <Heading
        title={manager ? "Orders & bidding" : "Orders & bids"}
        subtitle={
          manager
            ? `Post client orders, let chefs bid, and confirm the cheapest with a ${DEPOSIT_PERCENT}% deposit.`
            : "Bid on services near you. The lowest bid wins when bidding closes."
        }
      >
        {manager && (
          <div className="heading-actions">
            <button className="accept btn" onClick={onNewOrder}>
              <Plus size={14} /> Post order
            </button>
          </div>
        )}
      </Heading>
      <div className="filter-tabs" role="tablist" aria-label="Order status">
        {(manager ? staffTabs : chefTabs).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setOffset(0);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      {!result && !error && <p className="muted small-copy">Loading orders…</p>}
      {result?.rows.map((o) => (
        <div key={o.id}>
          <OrderCard
            o={o}
            manager={manager}
            now={now}
            selected={selected === o.id}
            onToggle={() => setSelected(selected === o.id ? null : o.id)}
          />
          {selected === o.id && (
            <OrderDetail
              o={o}
              data={data}
              manager={manager}
              now={now}
              busy={busy}
              run={run}
              version={version}
              openBooking={openBooking}
            />
          )}
        </div>
      ))}
      {result && !result.rows.length && (
        <Empty
          title="No orders here"
          text={
            manager
              ? "Post an order to start collecting chef bids."
              : "Orders in your service area will appear here."
          }
        />
      )}
      {result && (
        <Pager
          offset={offset}
          total={result.total}
          limit={PAGE_SIZE}
          onOffset={setOffset}
        />
      )}
    </>
  );
}

/** Chef dashboard card: orders won (awaiting deposit) and the latest open
 *  orders near the chef. */
export function ChefOrdersCard({
  version,
  now,
  openOrder,
}: {
  version: number;
  now: number;
  openOrder: (focus: OrderFocus) => void;
}) {
  const open = useOrders("open", 0, 3, version);
  const awarded = useOrders("awarded", 0, 5, version);
  const won = awarded.result?.rows.filter((o) => o.my_bid?.status === "won") ?? [];
  return (
    <article className="card section-gap">
      <div className="card-head">
        <div>
          <h2 className="card-title">Orders open for bids</h2>
          <p className="card-sub">
            {open.result
              ? `${open.result.total} open near you · lowest bid wins`
              : "Services near you · lowest bid wins"}
          </p>
        </div>
        <button
          className="text-button"
          onClick={() => openOrder({ tab: "open", id: null })}
        >
          VIEW ALL <ChevronRight size={13} />
        </button>
      </div>
      {(open.error || awarded.error) && (
        <p className="error-text small-copy">{open.error || awarded.error}</p>
      )}
      <div className="order-mini-list">
        {won.map((o) => (
          <button
            key={o.id}
            className="order-mini won"
            onClick={() => openOrder({ tab: "awarded", id: o.id })}
          >
            <b>You won {o.code}</b>
            <span>
              {o.customer} · {money(o.my_bid!.amount)} · awaiting client
              deposit
            </span>
          </button>
        ))}
        {open.result?.rows.map((o) => (
          <button
            key={o.id}
            className="order-mini"
            onClick={() => openOrder({ tab: "open", id: o.id })}
          >
            <b>
              {o.code} · {o.service}
            </b>
            <span>
              {date(o.scheduled_start)} · {o.location} ·{" "}
              {o.my_bid ? `Your bid ${money(o.my_bid.amount)}` : "Not bid yet"}
            </span>
            <small>{closesIn(o.bid_deadline, now)}</small>
          </button>
        ))}
        {open.result && !open.result.rows.length && !won.length && (
          <Empty
            title="No open orders"
            text="New orders in your area will appear here."
          />
        )}
      </div>
    </article>
  );
}

const ist = (value: string) => new Date(value + ":00+05:30").toISOString();

export function NewOrderModal({
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
  return (
    <Modal title="Post order" onClose={onClose}>
      <p className="small-copy muted">
        Chefs who serve this area and are free at this time can bid until the
        deadline. The lowest bid wins; the chef is assigned once the client
        pays the {DEPOSIT_PERCENT}% deposit. All times are in IST.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (key: string) => String(f.get(key) ?? "");
          if (
            await run(
              () =>
                repo.createOrder({
                  customer: get("customer"),
                  service: get("service"),
                  address: get("address"),
                  region,
                  location,
                  guests: Number(get("guests")),
                  scheduled_start: ist(get("start")),
                  scheduled_end: ist(get("end")),
                  bid_deadline: ist(get("deadline")),
                  overtime_rate: Number(get("rate")),
                  max_budget: get("budget") ? Number(get("budget")) : null,
                  dish_ids: f.getAll("dishes").map(String),
                  notes: get("notes"),
                }),
              "Order posted · chefs can now bid",
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
            <input name="service" required placeholder="Private dinner" maxLength={160} />
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
          <Field label="Guests">
            <input name="guests" type="number" min={1} max={500} required defaultValue={10} />
          </Field>
          <Field label="Bidding closes (IST)">
            <input name="deadline" type="datetime-local" required />
          </Field>
          <Field label="Scheduled in (IST)">
            <input name="start" type="datetime-local" required />
          </Field>
          <Field label="Scheduled out (IST)">
            <input name="end" type="datetime-local" required />
          </Field>
          <Field label="Client budget (₹, optional)">
            <input name="budget" type="number" min={1} max={1000000} step="0.01" />
          </Field>
          <Field label="Overtime rate (₹/hour)">
            <input name="rate" type="number" min={0} max={1000000} step="0.01" required defaultValue={300} />
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
            Post order
          </button>
        </div>
      </form>
    </Modal>
  );
}
