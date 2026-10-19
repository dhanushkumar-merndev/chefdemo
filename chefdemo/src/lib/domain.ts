import { servesArea } from "./service-areas";

export type Role = "admin" | "manager" | "chef";
export type Status =
  | "requested"
  | "upcoming"
  | "in_progress"
  | "completed"
  | "cancelled";
export const stages = ["entry", "before", "preparing", "after"] as const;
export type Stage = (typeof stages)[number];
export const stageLabels: Record<Stage, string> = {
  entry: "Entry photo",
  before: "Kitchen before",
  preparing: "Preparing food",
  after: "Kitchen after",
};
export const statusLabels: Record<Status, string> = {
  requested: "New request",
  upcoming: "Upcoming",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
export interface Profile {
  id: string;
  name: string;
  /** Empty for a member who signed up by mobile and has not added an email. */
  email: string | null;
  approval_status?: "pending" | "approved" | "rejected";
  role: Role;
  phone: string;
  /** Verified by OTP: the member can sign in with this mobile. */
  phone_verified?: boolean;
  cuisine: string;
  experience: number;
  online: boolean;
  region: string;
  location: string;
  /** A chef's specialisation; empty for staff (and chefs who have not set it). */
  chef_type?: ChefType | "";
}
export interface Dish {
  id: string;
  name: string;
  cuisine: string;
  vegetarian: boolean;
  active: boolean;
}
export interface Booking {
  id: string;
  code: string;
  chef_id: string;
  customer: string;
  service: string;
  address: string;
  region: string;
  location: string;
  guests: number;
  scheduled_start: string;
  scheduled_end: string;
  actual_in: string | null;
  actual_out: string | null;
  status: Status;
  base_amount: number;
  overtime_rate: number;
  overtime_amount: number;
  dish_ids: string[];
  notes: string;
  /** The order this booking was confirmed from, if it came through bidding. */
  order_id?: string | null;
  /** Client deposit already paid for this booking. */
  deposit_amount?: number;
}
export interface Photo {
  id: string;
  booking_id: string;
  stage: Stage;
  path: string;
  created_at: string;
}
export interface Review {
  id: string;
  booking_id: string;
  customer: string;
  rating: number;
  comment: string;
}
export interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: "open" | "resolved";
  created_at: string;
}
export interface ServiceArea {
  id: string;
  region: string;
  name: string;
  active: boolean;
}
export interface StaffAccess {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface Data {
  profiles: Profile[];
  dishes: Dish[];
  bookings: Booking[];
  photos: Photo[];
  reviews: Review[];
  tickets: Ticket[];
  staff_access: StaffAccess[];
  service_areas: ServiceArea[];
}
export type BookingAction =
  | "accept"
  | "reject"
  | "check_in"
  | "complete"
  | "save_dishes"
  | "cancel";
export type NewBooking = Pick<
  Booking,
  | "chef_id"
  | "customer"
  | "service"
  | "address"
  | "region"
  | "location"
  | "guests"
  | "scheduled_start"
  | "scheduled_end"
  | "base_amount"
  | "overtime_rate"
  | "dish_ids"
  | "notes"
>;
export const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
export const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "Not recorded";
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
export const dayKey = (value: string | number) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function overtime(booking: Booking, now = Date.now()) {
  if (!booking.actual_in || booking.status === "cancelled")
    return { minutes: 0, amount: 0 };
  const end = booking.actual_out ? new Date(booking.actual_out).getTime() : now;
  const minutes = Math.max(
    0,
    Math.ceil((end - new Date(booking.scheduled_end).getTime()) / 60_000),
  );
  return {
    minutes,
    amount: Math.round(((minutes * booking.overtime_rate) / 60) * 100) / 100,
  };
}
export function validateBooking(b: NewBooking) {
  if (
    !b.customer.trim() ||
    !b.service.trim() ||
    !b.address.trim() ||
    !b.chef_id
  )
    throw new Error("Customer, service, address and chef are required.");
  if (!b.region.trim() || !b.location.trim())
    throw new Error("Select the region and location of this service.");
  if (
    !Number.isFinite(Date.parse(b.scheduled_start)) ||
    !Number.isFinite(Date.parse(b.scheduled_end)) ||
    Date.parse(b.scheduled_end) <= Date.parse(b.scheduled_start)
  )
    throw new Error("Scheduled out time must be after in time.");
  if (!Number.isInteger(b.guests) || b.guests < 1 || b.guests > 500)
    throw new Error("Guest count must be between 1 and 500.");
  if (
    ![b.base_amount, b.overtime_rate].every(
      (x) => Number.isFinite(x) && x >= 0 && x <= 1_000_000,
    )
  )
    throw new Error("Enter valid non-negative amounts (up to ₹10,00,000).");
}
export function transition(
  booking: Booking,
  action: BookingAction,
  photos: Photo[],
  dishes: string[],
  now = Date.now(),
): Booking {
  const b = { ...booking };
  if (action === "accept" || action === "reject") {
    if (b.status !== "requested")
      throw new Error("This request has already been handled.");
    b.status = action === "accept" ? "upcoming" : "cancelled";
  } else if (action === "cancel") {
    if (!["requested", "upcoming"].includes(b.status))
      throw new Error("Only unstarted bookings can be cancelled.");
    b.status = "cancelled";
  } else if (action === "save_dishes") {
    if (!["requested", "upcoming", "in_progress"].includes(b.status))
      throw new Error("This menu is locked.");
    if (!dishes.length) throw new Error("Select at least one dish.");
    b.dish_ids = [...new Set(dishes)];
  } else if (action === "check_in") {
    if (b.status !== "upcoming")
      throw new Error("Only an upcoming service can be started.");
    if (!b.dish_ids.length)
      throw new Error("Select your dishes before checking in.");
    if (
      !["entry", "before"].every((stage) =>
        photos.some((p) => p.booking_id === b.id && p.stage === stage),
      )
    )
      throw new Error(
        "Upload entry and kitchen-before photos before checking in.",
      );
    b.actual_in = new Date(now).toISOString();
    b.status = "in_progress";
  } else if (action === "complete") {
    if (b.status !== "in_progress")
      throw new Error("Check in before completing a service.");
    if (
      !b.dish_ids.length ||
      !stages.every((stage) =>
        photos.some((p) => p.booking_id === b.id && p.stage === stage),
      )
    )
      throw new Error(
        "Select dishes and upload all four kitchen photos to complete the service.",
      );
    b.actual_out = new Date(now).toISOString();
    b.status = "completed";
    b.overtime_amount = overtime(b, now).amount;
  }
  return b;
}
export function validatePhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG or WebP image.");
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw new Error("Photo must be between 1 byte and 5 MB.");
}
export function csvCell(value: unknown) {
  const s = String(value ?? "");
  return (
    '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'
  );
}

/** How to show a member: their email, or their mobile when they have none. */
export const contactOf = (p: Pick<Profile, "email" | "phone">) =>
  p.email || p.phone;

// ---- Chef marketplace: orders, bids and the 20% deposit ----
export const chefTypes = [
  "home_cook",
  "professional_chef",
  "caterer",
  "baker",
  "tandoor_specialist",
] as const;
export type ChefType = (typeof chefTypes)[number];
export const chefTypeLabels: Record<ChefType, string> = {
  home_cook: "Home cook",
  professional_chef: "Professional chef",
  caterer: "Caterer",
  baker: "Baker",
  tandoor_specialist: "Tandoor specialist",
};
export const chefTypeLabel = (type: string | undefined) =>
  chefTypeLabels[type as ChefType] ?? "Type not set";
export type OrderStatus =
  | "open"
  | "awarded"
  | "confirmed"
  | "unfilled"
  | "cancelled";
export const orderStatusLabels: Record<OrderStatus, string> = {
  open: "Open for bids",
  awarded: "Awaiting deposit",
  confirmed: "Confirmed",
  unfilled: "No bids",
  cancelled: "Cancelled",
};
export type BidStatus = "active" | "withdrawn" | "won" | "lost";
export const bidStatusLabels: Record<BidStatus, string> = {
  active: "Bid placed",
  withdrawn: "Withdrawn",
  won: "Won",
  lost: "Not selected",
};
export interface Order {
  id: string;
  code: string;
  customer: string;
  service: string;
  /** Hidden from a chef until they win the order. */
  address: string | null;
  region: string;
  location: string;
  guests: number;
  scheduled_start: string;
  scheduled_end: string;
  bid_deadline: string;
  overtime_rate: number;
  max_budget: number | null;
  dish_ids: string[];
  notes: string;
  status: OrderStatus;
  winning_bid_id?: string | null;
  deposit_amount: number;
  deposit_ref?: string | null;
  deposit_paid_at?: string | null;
  booking_id: string | null;
  created_at: string;
}
export interface Bid {
  id: string;
  order_id: string;
  chef_id: string;
  amount: number;
  message: string;
  status: BidStatus;
  created_at: string;
  /** When the current amount was offered; ties go to the earliest. */
  updated_at: string;
}
/** An order as list_orders returns it: staff get bid totals, a chef their own bid. */
export interface OrderRow extends Order {
  bid_count?: number;
  lowest_bid?: number | null;
  winner_id?: string | null;
  winner_name?: string | null;
  winning_amount?: number | null;
  my_bid?: Pick<Bid, "amount" | "message" | "status" | "updated_at"> | null;
}
export interface BidRow extends Bid {
  chef_name: string;
  chef_type: ChefType | "";
  experience: number;
  chef_region: string;
  chef_location: string;
}
/** Demo-mode storage also keeps orders and bids; live mode pages them via RPC. */
export interface Marketplace {
  orders: Order[];
  bids: Bid[];
}
export interface Paged<T> {
  rows: T[];
  total: number;
}
export type NewOrder = Pick<
  Order,
  | "customer"
  | "service"
  | "address"
  | "region"
  | "location"
  | "guests"
  | "scheduled_start"
  | "scheduled_end"
  | "bid_deadline"
  | "overtime_rate"
  | "max_budget"
  | "dish_ids"
  | "notes"
> & { address: string };
export interface ChefFilter {
  region: string;
  location: string;
  chef_type: ChefType | "";
  min_experience: number;
  /** Free between start and end (ISO); both blank skips the check. */
  start: string;
  end: string;
  online_only: boolean;
}
export type ChefResult = Pick<
  Profile,
  | "id"
  | "name"
  | "email"
  | "phone"
  | "chef_type"
  | "experience"
  | "cuisine"
  | "region"
  | "location"
  | "online"
>;

/** The client's deposit: 20% of the winning bid, to the paisa. Bids are whole
 *  paise, so 20% never lands on a half paisa and rounding agrees with SQL. */
export const DEPOSIT_PERCENT = 20;
export const depositFor = (amount: number) => Math.round(amount * 20) / 100;

const overlaps = (
  a: { scheduled_start: string; scheduled_end: string },
  start: string,
  end: string,
) =>
  Date.parse(a.scheduled_start) < Date.parse(end) &&
  Date.parse(a.scheduled_end) > Date.parse(start);

/** Matches chef_busy in SQL: an unfinished booking, or an order awarded to the
 *  chef that still awaits its deposit, overlaps the given time. */
export function chefBusy(
  state: { bookings: Booking[]; orders: Order[]; bids: Bid[] },
  chefId: string,
  start: string,
  end: string,
  exceptOrder?: string,
) {
  return (
    state.bookings.some(
      (b) =>
        b.chef_id === chefId &&
        b.status !== "completed" &&
        b.status !== "cancelled" &&
        overlaps(b, start, end),
    ) ||
    state.orders.some(
      (o) =>
        o.status === "awarded" &&
        o.id !== exceptOrder &&
        overlaps(o, start, end) &&
        state.bids.some(
          (b) =>
            b.id === o.winning_bid_id &&
            b.chef_id === chefId &&
            b.status === "won",
        ),
    )
  );
}

/** The cheapest eligible active bid; ties go to the earliest offer. */
export function pickWinner(bids: Bid[], eligible: (bid: Bid) => boolean) {
  return (
    bids
      .filter((b) => b.status === "active" && eligible(b))
      .sort(
        (a, b) =>
          a.amount - b.amount ||
          a.updated_at.localeCompare(b.updated_at) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}

/** Same rounds as settle_orders in SQL: every due order gets its cheapest
 *  eligible bid, one award per chef per round (earliest deadline first), until
 *  a round awards nothing; the rest are unfilled. Returns new arrays. */
export function settleOrders(
  state: {
    bookings: Booking[];
    orders: Order[];
    bids: Bid[];
    profiles: Profile[];
  },
  now = Date.now(),
  only?: string,
) {
  const orders = state.orders.map((o) => ({ ...o }));
  const bids = state.bids.map((b) => ({ ...b }));
  const due = orders.filter(
    (o) =>
      o.status === "open" &&
      Date.parse(o.bid_deadline) <= now &&
      (!only || o.id === only),
  );
  const approvedChef = (id: string) =>
    state.profiles.some(
      (p) =>
        p.id === id &&
        p.role === "chef" &&
        (p.approval_status ?? "approved") === "approved",
    );
  for (;;) {
    const view = { bookings: state.bookings, orders, bids };
    const picks = new Map<string, { order: Order; bid: Bid }>();
    for (const order of due.filter((o) => o.status === "open")) {
      const bid = pickWinner(
        bids.filter((b) => b.order_id === order.id),
        (b) =>
          approvedChef(b.chef_id) &&
          !chefBusy(view, b.chef_id, order.scheduled_start, order.scheduled_end),
      );
      if (!bid) continue;
      const held = picks.get(bid.chef_id);
      if (
        !held ||
        order.bid_deadline < held.order.bid_deadline ||
        (order.bid_deadline === held.order.bid_deadline &&
          order.id < held.order.id)
      )
        picks.set(bid.chef_id, { order, bid });
    }
    if (!picks.size) break;
    for (const { order, bid } of picks.values()) {
      order.status = "awarded";
      order.winning_bid_id = bid.id;
      for (const b of bids)
        if (b.order_id === order.id && b.status === "active")
          b.status = b.id === bid.id ? "won" : "lost";
    }
  }
  for (const order of due) if (order.status === "open") order.status = "unfilled";
  return { orders, bids };
}

export function validateOrder(o: NewOrder, now = Date.now()) {
  if (!o.customer.trim() || !o.service.trim() || !o.address.trim())
    throw new Error("Customer, service and address are required.");
  if (!o.region.trim() || !o.location.trim())
    throw new Error("Select the region and location of this service.");
  const start = Date.parse(o.scheduled_start),
    end = Date.parse(o.scheduled_end),
    deadline = Date.parse(o.bid_deadline);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error("Scheduled out time must be after in time.");
  if (!Number.isFinite(deadline) || deadline <= now || deadline > start)
    throw new Error(
      "The bidding deadline must be in the future and before the service starts.",
    );
  if (!Number.isInteger(o.guests) || o.guests < 1 || o.guests > 500)
    throw new Error("Guest count must be between 1 and 500.");
  if (
    !Number.isFinite(o.overtime_rate) ||
    o.overtime_rate < 0 ||
    o.overtime_rate > 1_000_000
  )
    throw new Error("Enter a valid non-negative overtime rate.");
  if (
    o.max_budget !== null &&
    !(Number.isFinite(o.max_budget) && o.max_budget >= 1 && o.max_budget <= 1_000_000)
  )
    throw new Error("Enter a budget between ₹1 and ₹10,00,000.");
}

export function validateBid(
  order: Pick<Order, "status" | "bid_deadline" | "max_budget">,
  amount: number,
  now = Date.now(),
) {
  if (order.status !== "open" || Date.parse(order.bid_deadline) <= now)
    throw new Error("Bidding has closed for this order.");
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000)
    throw new Error("Enter a bid between ₹1 and ₹10,00,000.");
  if (order.max_budget !== null && amount > order.max_budget)
    throw new Error("Your bid is above this order's budget.");
}

/** Matches chef_matches in SQL. `busy` answers the availability window. */
export function matchesChefFilter(
  p: Profile,
  f: ChefFilter,
  busy: (chefId: string) => boolean,
) {
  return (
    p.role === "chef" &&
    (p.approval_status ?? "approved") === "approved" &&
    (!f.region || p.region === f.region) &&
    (!f.location || servesArea(p, f.region, f.location)) &&
    (!f.chef_type || p.chef_type === f.chef_type) &&
    p.experience >= f.min_experience &&
    (!f.online_only || p.online) &&
    (!f.start || !f.end || !busy(p.id))
  );
}
