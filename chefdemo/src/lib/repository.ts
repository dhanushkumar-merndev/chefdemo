import { supabase } from "./supabase";
import { demoAdmin, demoChef, seedData } from "./seed";
import { mergeServiceAreas, servesArea, type LocationSuggestion } from "./service-areas";
import {
  Bid,
  BidRow,
  BookingAction,
  ChefFilter,
  ChefResult,
  Data,
  Dish,
  Marketplace,
  NewBooking,
  NewOrder,
  OrderRow,
  OrderStatus,
  Paged,
  Photo,
  Profile,
  Role,
  Stage,
  ServiceArea,
  Ticket,
  chefBusy,
  depositFor,
  matchesChefFilter,
  settleOrders,
  transition,
  validateBid,
  validateBooking,
  validateOrder,
  validatePhoto,
} from "./domain";

const dataKey = "chefflow-prototype-v1";
const userKey = "chefflow-user-v1";
export const isDemo = !supabase;
type Store = Data & Marketplace;
function localData(): Store {
  const saved = localStorage.getItem(dataKey);
  if (saved) {
    const data = JSON.parse(saved) as Store;
    const areas = mergeServiceAreas(data.service_areas ?? [], seedData().service_areas);
    // Sessions saved before bidding existed start with no orders, and their
    // chefs are asked for a chef type (as the live migration's '' default does).
    if (areas.length !== data.service_areas?.length || !data.orders || !data.bids) {
      data.service_areas = areas;
      data.orders ??= [];
      data.bids ??= [];
      for (const p of data.profiles) if (p.role === "chef") p.chef_type ??= "";
      localStorage.setItem(dataKey, JSON.stringify(data));
    }
    return data;
  }
  const data = seedData();
  localStorage.setItem(dataKey, JSON.stringify(data));
  return data;
}
function saveLocal(data: Data) {
  localStorage.setItem(dataKey, JSON.stringify(data));
}
function actor(data: Data) {
  const user = data.profiles.find(
    (p) => p.id === localStorage.getItem(userKey),
  );
  if (!user) throw new Error("Please sign in again.");
  return user;
}
function requireAdmin(data: Data) {
  if (actor(data).role !== "admin")
    throw new Error("Administrator access is required.");
}
function requireManager(data: Data) {
  if (actor(data).role === "chef")
    throw new Error("Manager access is required.");
}
function mayAccess(data: Data, id: string) {
  const b = data.bookings.find((b) => b.id === id);
  if (!b || (actor(data).role === "chef" && b.chef_id !== actor(data).id))
    throw new Error("Booking not found or access denied.");
  return b;
}
async function rpc<T = void>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase!.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function currentUser() {
  if (!supabase) return localStorage.getItem(userKey);
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  return data.user?.id ?? null;
}
export async function login(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
}
export const smsLoginEnabled =
  !isDemo && process.env.NEXT_PUBLIC_SMS_LOGIN === "on";
async function smsCall<T>(
  path: string,
  input: Record<string, string>,
  signedIn = false,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signedIn) {
    const { data } = await supabase!.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(`/api/auth/sms/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? "SMS verification failed. Please try again.");
  return body;
}
export type SmsIntent = "login" | "signup" | "link";
/** Sends a code (see /api/auth/sms/send). "link" verifies a mobile for the
 *  signed-in member's own account. */
export function smsSendOtp(phone: string, intent: SmsIntent) {
  return smsCall<{ reqId: string; resendAfter: number }>(
    "send",
    { phone, intent },
    intent === "link",
  );
}
/** Checks the code (see /api/auth/sms/verify). Signs in, creating the account
 *  first when a name is given; for "link" it verifies the mobile instead. */
export async function smsVerifyOtp(
  phone: string,
  reqId: string,
  code: string,
  options: { intent: SmsIntent; name?: string },
) {
  const body = await smsCall<{ tokenHash?: string }>(
    "verify",
    { phone, reqId, code, intent: options.intent, name: options.name ?? "" },
    options.intent === "link",
  );
  if (options.intent === "link") return;
  const { error } = await supabase!.auth.verifyOtp({
    token_hash: body.tokenHash!,
    type: "magiclink",
  });
  if (error) throw error;
}
/** A member who signed up by mobile adds email + password sign-in. Supabase
 *  emails a confirmation link; the email works once it is confirmed. */
export async function addEmailLogin(email: string, password: string) {
  const { error } = await supabase!.auth.updateUser(
    { email: email.trim().toLowerCase(), password },
    { emailRedirectTo: window.location.origin },
  );
  if (error?.code === "email_exists")
    throw new Error("This email is already used by another account.");
  if (error) throw error;
}
/** The email address waiting for confirmation, if any. */
export async function pendingEmail() {
  const { data } = await supabase!.auth.getUser();
  return data.user?.new_email ?? null;
}
export async function register(name: string, email: string, password: string) {
  const { data, error } = await supabase!.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { name } },
  });
  if (error?.code === "email_address_invalid")
    throw new Error(
      "Supabase rejected this email address. Use a real inbox (test domains like example.com or test.com are blocked) and the exact email your administrator added.",
    );
  if (error) throw error;
  return Boolean(data.session);
}
export function demoLogin(role: "admin" | "chef") {
  localData();
  localStorage.setItem(userKey, role === "admin" ? demoAdmin : demoChef);
}
export async function logout() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } else localStorage.removeItem(userKey);
}
export async function loadData(): Promise<Data> {
  if (!supabase) {
    const data = localData();
    const user = actor(data);
    if (user.role !== "chef") return data;
    const bookings = data.bookings.filter((b) => b.chef_id === user.id);
    const ids = bookings.map((b) => b.id);
    return {
      ...data,
      profiles: [user],
      bookings,
      photos: data.photos.filter((p) => ids.includes(p.booking_id)),
      reviews: data.reviews.filter((r) => ids.includes(r.booking_id)),
      tickets: data.tickets.filter((t) => t.user_id === user.id),
      staff_access: [],
    };
  }
  const tables = [
    "profiles",
    "dishes",
    "bookings",
    "service_photos",
    "reviews",
    "tickets",
    "staff_access",
    "service_areas",
  ];
  const results = await Promise.all(
    tables.map((t) => supabase!.from(t).select("*")),
  );
  const error = results.find((r) => r.error)?.error;
  if (error)
    throw new Error(
      `${error.message}. Check that the Supabase migration has been applied.`,
    );
  return {
    profiles: results[0].data,
    dishes: results[1].data,
    bookings: results[2].data,
    photos: results[3].data,
    reviews: results[4].data,
    tickets: results[5].data,
    staff_access: results[6].data,
    service_areas: results[7].data,
  } as unknown as Data;
}

async function locationRequest(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.set("authorization", `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(path, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Location search is unavailable. Please try again.");
  return body;
}

export async function searchServiceLocations(region: string, q: string, signal: AbortSignal): Promise<LocationSuggestion[]> {
  const body = await locationRequest(`/api/locations?${new URLSearchParams({ region, q })}`, { signal });
  return body.suggestions;
}

export async function selectServiceLocation(token: string, signal: AbortSignal): Promise<ServiceArea> {
  const { area } = await locationRequest("/api/locations", {
    method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  }) as { area: ServiceArea };
  if (!supabase) {
    const data = localData();
    actor(data);
    const existing = data.service_areas.find((a) => a.region === area.region && a.name === area.name);
    if (existing && !existing.active) throw new Error("This location is currently unavailable for service.");
    data.service_areas = mergeServiceAreas(data.service_areas, [area]);
    saveLocal(data);
  }
  return area;
}
export async function actOnBooking(
  id: string,
  action: BookingAction,
  dishIds: string[] = [],
) {
  if (supabase)
    return rpc("booking_action", {
      p_id: id,
      p_action: action,
      p_dishes: dishIds,
    });
  const data = localData();
  const b = mayAccess(data, id);
  if (action === "cancel") requireManager(data);
  if (
    action === "save_dishes" &&
    dishIds.some((id) => !data.dishes.some((d) => d.id === id && d.active))
  )
    throw new Error("Choose active dishes from the menu.");
  if (
    action === "check_in" &&
    data.bookings.some(
      (x) => x.chef_id === b.chef_id && x.status === "in_progress",
    )
  )
    throw new Error(
      "Complete the current service before checking in to another.",
    );
  data.bookings = data.bookings.map((x) =>
    x.id === id ? transition(b, action, data.photos, dishIds) : x,
  );
  saveLocal(data);
}
export async function createBooking(input: NewBooking) {
  validateBooking(input);
  if (supabase) return rpc("create_booking", { p_input: input });
  const data = localData();
  requireManager(data);
  if (!data.profiles.some((p) => p.id === input.chef_id && p.role === "chef"))
    throw new Error("Select a chef.");
  if (
    input.dish_ids.some(
      (id) => !data.dishes.some((d) => d.id === id && d.active),
    )
  )
    throw new Error("Select active dishes.");
  if (chefBusy(data, input.chef_id, input.scheduled_start, input.scheduled_end))
    throw new Error("This chef already has a booking during these timings.");
  data.bookings.push({
    ...input,
    id: crypto.randomUUID(),
    code: `CF-${1000 + data.bookings.length + 1}`,
    status: "requested",
    actual_in: null,
    actual_out: null,
    overtime_amount: 0,
  });
  saveLocal(data);
}
export async function saveProfile(
  input: Pick<
    Profile,
    "name" | "phone" | "cuisine" | "experience" | "online" | "region" | "location"
  > & { chef_type: NonNullable<Profile["chef_type"]> },
) {
  const data = supabase ? null : localData();
  const actorRole = data ? actor(data).role : null;
  if (actorRole === "chef" && (!input.region.trim() || !input.location.trim()))
    throw new Error("Select the region and location you work in.");
  if (actorRole === "chef" && !input.chef_type)
    throw new Error("Select your chef type.");
  if (supabase) return rpc("save_profile", { p_input: input });
  const me = actor(data!);
  Object.assign(me, input, me.role === "chef" ? {} : { chef_type: me.chef_type ?? "" });
  saveLocal(data!);
}
export async function saveDish(dish: Dish) {
  if (supabase) {
    const { error } = await supabase.from("dishes").upsert(dish);
    if (error) throw error;
    return;
  }
  const data = localData();
  requireManager(data);
  data.dishes = [...data.dishes.filter((d) => d.id !== dish.id), dish];
  saveLocal(data);
}
export async function authorizeStaff(name: string, email: string, role: Role) {
  if (supabase)
    return rpc("authorize_staff", {
      p_name: name,
      p_email: email,
      p_role: role,
    });
  const data = localData();
  requireAdmin(data);
  email = email.trim().toLowerCase();
  if (
    data.profiles.some((p) => p.email === email) ||
    data.staff_access.some((p) => p.email === email)
  )
    throw new Error("This email is already registered or authorized.");
  data.profiles.push({
    id: crypto.randomUUID(),
    name,
    email,
    role,
    approval_status: "pending",
    phone: "",
    cuisine: "",
    experience: 0,
    online: true,
    region: "",
    location: "",
  });
  saveLocal(data);
}
export async function setRole(id: string, role: Role) {
  if (supabase) return rpc("set_staff_role", { p_id: id, p_role: role });
  const data = localData();
  requireAdmin(data);
  if (id === actor(data).id)
    throw new Error("You cannot change your own administrator role.");
  if (
    role !== "chef" &&
    data.bookings.some(
      (b) =>
        b.chef_id === id &&
        ["requested", "upcoming", "in_progress"].includes(b.status),
    )
  )
    throw new Error(
      "Finish or cancel this chef's open bookings before changing their role.",
    );
  const p = data.profiles.find((p) => p.id === id);
  if (!p) throw new Error("Staff member not found.");
  p.role = role;
  saveLocal(data);
}
export async function uploadPhoto(bookingId: string, stage: Stage, file: File) {
  validatePhoto(file);
  if (supabase) {
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[file.type];
    const path = `${bookingId}/${stage}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage
      .from("kitchen-photos")
      .upload(path, file, { contentType: file.type });
    if (error) throw error;
    const { error: insertError } = await supabase
      .from("service_photos")
      .upsert(
        { booking_id: bookingId, stage, path },
        { onConflict: "booking_id,stage" },
      );
    if (insertError) {
      await supabase.storage.from("kitchen-photos").remove([path]);
      throw insertError;
    }
    return;
  }
  const data = localData();
  const b = mayAccess(data, bookingId);
  if (!["upcoming", "in_progress"].includes(b.status))
    throw new Error(
      "Photos can only be updated for an accepted or active service.",
    );
  if (["preparing", "after"].includes(stage) && b.status !== "in_progress")
    throw new Error("Check in before uploading preparation and after photos.");
  const path = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
  data.photos = [
    ...data.photos.filter(
      (p) => !(p.booking_id === bookingId && p.stage === stage),
    ),
    {
      id: crypto.randomUUID(),
      booking_id: bookingId,
      stage,
      path,
      created_at: new Date().toISOString(),
    },
  ];
  try {
    saveLocal(data);
  } catch {
    throw new Error(
      "Browser storage is full. Use a smaller photo or connect Supabase for more storage.",
    );
  }
}
export async function photoUrl(photo: Photo) {
  if (!supabase) return photo.path;
  const { data, error } = await supabase.storage
    .from("kitchen-photos")
    .createSignedUrl(photo.path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
export async function createTicket(subject: string, message: string) {
  const userId = await currentUser();
  const ticket: Ticket = {
    id: crypto.randomUUID(),
    user_id: userId!,
    subject,
    message,
    status: "open",
    created_at: new Date().toISOString(),
  };
  if (supabase) {
    const { error } = await supabase.from("tickets").insert(ticket);
    if (error) throw error;
    return;
  }
  const data = localData();
  if (actor(data).role === "admin")
    throw new Error("Administrators cannot raise support tickets.");
  data.tickets.push(ticket);
  saveLocal(data);
}
export async function resolveTicket(id: string) {
  if (supabase) {
    const { error } = await supabase
      .from("tickets")
      .update({ status: "resolved" })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const data = localData();
  requireManager(data);
  const t = data.tickets.find((t) => t.id === id);
  if (t) t.status = "resolved";
  saveLocal(data);
}

export async function reviewMember(id: string, status: "approved" | "rejected") {
 if(supabase) return rpc("review_member", {p_id:id,p_status:status});
 const data=localData(); requireAdmin(data);
 if(id===actor(data).id) throw new Error("You cannot change your own approval.");
 if(status==="rejected" && data.bookings.some(b=>b.chef_id===id && ["requested","upcoming","in_progress"].includes(b.status))) throw new Error("Complete or cancel open bookings first.");
 const member=data.profiles.find(p=>p.id===id); if(!member) throw new Error("Member not found.");
 member.approval_status=status; saveLocal(data);
}

// ---- Orders and bidding ----
// Live mode: secured RPCs (see 202610190001_chef_bidding.sql). Demo mode
// applies the same rules from domain.ts to browser storage.

/** Applies settlement; true when an order changed (so storage needs saving).
 *  Saving only on change keeps other open tabs from reloading in a loop. */
function settleLocal(data: Store, only?: string) {
  const { orders, bids } = settleOrders(data, Date.now(), only);
  const changed = orders.some((o, i) => o.status !== data.orders[i].status);
  data.orders = orders;
  data.bids = bids;
  return changed;
}
function localOrder(data: Store, id: string) {
  const order = data.orders.find((o) => o.id === id);
  if (!order) throw new Error("Order not found.");
  return order;
}
function requireChef(data: Store) {
  const me = actor(data);
  if (me.role !== "chef") throw new Error("Only approved chefs can bid.");
  return me;
}
/** A paged RPC result; anything else (e.g. an older database) is an error,
 *  not an empty list. */
async function pagedRpc<T>(name: string, args: Record<string, unknown>) {
  const result = await rpc<Paged<T> | null>(name, args);
  if (!result || !Array.isArray(result.rows) || typeof result.total !== "number")
    throw new Error(`Unexpected response from ${name}`);
  return result;
}
const page = <T>(rows: T[], limit: number, offset: number): Paged<T> => ({
  rows: rows.slice(offset, offset + limit),
  total: rows.length,
});
const newest = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);

/** One page of orders. Settles orders whose bidding deadline has passed first. */
export async function listOrders(
  status: OrderStatus | "all",
  limit = 20,
  offset = 0,
): Promise<Paged<OrderRow>> {
  if (supabase)
    return pagedRpc<OrderRow>("list_orders", {
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    });
  const data = localData();
  const me = actor(data);
  if (settleLocal(data)) saveLocal(data);
  const wanted = data.orders.filter((o) => status === "all" || o.status === status);
  if (me.role !== "chef")
    return page(
      wanted.sort(newest).map((o): OrderRow => {
        const live = data.bids.filter((b) => b.order_id === o.id && b.status !== "withdrawn");
        const win = data.bids.find((b) => b.id === o.winning_bid_id);
        return {
          ...o,
          bid_count: live.length,
          lowest_bid: live.length ? Math.min(...live.map((b) => b.amount)) : null,
          winner_id: win?.chef_id ?? null,
          winner_name: data.profiles.find((p) => p.id === win?.chef_id)?.name ?? null,
          winning_amount: win?.amount ?? null,
        };
      }),
      limit,
      offset,
    );
  const mine = (orderId: string) =>
    data.bids.find((b) => b.order_id === orderId && b.chef_id === me.id);
  return page(
    wanted
      .filter((o) => (o.status === "open" && servesArea(me, o.region, o.location)) || mine(o.id))
      .sort(newest)
      .map((o): OrderRow => {
        const bid = mine(o.id);
        const won = bid?.status === "won";
        return {
          ...o,
          address: won ? o.address : null,
          booking_id: won ? o.booking_id : null,
          deposit_amount: won ? o.deposit_amount : 0,
          winning_bid_id: undefined,
          deposit_ref: undefined,
          deposit_paid_at: undefined,
          my_bid: bid
            ? { amount: bid.amount, message: bid.message, status: bid.status, updated_at: bid.updated_at }
            : null,
        };
      }),
    limit,
    offset,
  );
}
/** Every bid on an order, cheapest first (staff only). */
export async function orderBids(orderId: string): Promise<BidRow[]> {
  if (supabase) {
    const rows = await rpc<BidRow[] | null>("order_bids", { p_order: orderId });
    if (!Array.isArray(rows)) throw new Error("Unexpected response from order_bids");
    return rows;
  }
  const data = localData();
  requireManager(data);
  return data.bids
    .filter((b) => b.order_id === orderId)
    .sort(
      (a, b) =>
        Number(a.status === "withdrawn") - Number(b.status === "withdrawn") ||
        a.amount - b.amount ||
        a.updated_at.localeCompare(b.updated_at) ||
        a.id.localeCompare(b.id),
    )
    .map((b) => {
      const p = data.profiles.find((p) => p.id === b.chef_id);
      return {
        ...b,
        chef_name: p?.name ?? "Unknown chef",
        chef_type: p?.chef_type ?? "",
        experience: p?.experience ?? 0,
        chef_region: p?.region ?? "",
        chef_location: p?.location ?? "",
      };
    });
}
export async function createOrder(input: NewOrder) {
  validateOrder(input);
  if (supabase) return rpc<string>("create_order", { p_input: input });
  const data = localData();
  requireManager(data);
  if (!data.service_areas.some((a) => a.region === input.region && a.name === input.location && a.active))
    throw new Error("Choose a location from the list.");
  if (input.dish_ids.some((id) => !data.dishes.some((d) => d.id === id && d.active)))
    throw new Error("Select active dishes.");
  const id = crypto.randomUUID();
  data.orders.push({
    ...input,
    id,
    code: `OR-${1000 + data.orders.length + 1}`,
    status: "open",
    winning_bid_id: null,
    deposit_amount: 0,
    deposit_ref: null,
    deposit_paid_at: null,
    booking_id: null,
    created_at: new Date().toISOString(),
  });
  saveLocal(data);
  return id;
}
/** Places or revises the chef's sealed bid until the deadline. */
export async function placeBid(orderId: string, amount: number, message = "") {
  if (supabase)
    return rpc("place_bid", { p_order: orderId, p_amount: amount, p_message: message });
  const data = localData();
  const me = requireChef(data);
  const order = localOrder(data, orderId);
  validateBid(order, amount);
  if (!servesArea(me, order.region, order.location))
    throw new Error("This order is outside the area you serve.");
  if (chefBusy(data, me.id, order.scheduled_start, order.scheduled_end))
    throw new Error("You already have a booking during these timings.");
  const now = new Date().toISOString();
  const text = message.trim().slice(0, 500);
  const existing = data.bids.find((b) => b.order_id === orderId && b.chef_id === me.id);
  if (existing) {
    if (existing.amount !== amount || existing.status !== "active") existing.updated_at = now;
    Object.assign(existing, { amount, message: text, status: "active" });
  } else
    data.bids.push({
      id: crypto.randomUUID(),
      order_id: orderId,
      chef_id: me.id,
      amount,
      message: text,
      status: "active",
      created_at: now,
      updated_at: now,
    } satisfies Bid);
  saveLocal(data);
}
export async function withdrawBid(orderId: string) {
  if (supabase) return rpc("withdraw_bid", { p_order: orderId });
  const data = localData();
  const me = requireChef(data);
  const order = localOrder(data, orderId);
  if (order.status !== "open" || Date.parse(order.bid_deadline) <= Date.now())
    throw new Error("Bidding has closed for this order.");
  const bid = data.bids.find((b) => b.order_id === orderId && b.chef_id === me.id && b.status === "active");
  if (!bid) throw new Error("You have no active bid on this order.");
  bid.status = "withdrawn";
  saveLocal(data);
}
/** Ends bidding now; the cheapest eligible bid wins. */
export async function closeBidding(orderId: string) {
  if (supabase) return rpc("close_bidding", { p_order: orderId });
  const data = localData();
  requireManager(data);
  const order = localOrder(data, orderId);
  if (order.status !== "open") throw new Error("Only an open order can be closed.");
  const now = new Date().toISOString();
  if (order.bid_deadline > now) order.bid_deadline = now;
  settleLocal(data, orderId);
  saveLocal(data);
}
/** Records the client's 20% deposit and assigns the winning chef. Simulated:
 *  a payment gateway (e.g. Razorpay order + verified webhook) replaces this. */
export async function payDeposit(orderId: string) {
  if (supabase) return rpc<string>("record_deposit", { p_order: orderId });
  const data = localData();
  requireManager(data);
  const order = localOrder(data, orderId);
  if (order.status === "confirmed")
    throw new Error("The deposit for this order has already been recorded.");
  if (order.status !== "awarded")
    throw new Error("Close bidding and award the order before recording the deposit.");
  const win = data.bids.find((b) => b.id === order.winning_bid_id)!;
  if (chefBusy(data, win.chef_id, order.scheduled_start, order.scheduled_end, order.id))
    throw new Error("The winning chef is no longer available for these timings.");
  const deposit = depositFor(win.amount);
  const bookingId = crypto.randomUUID();
  data.bookings.push({
    id: bookingId,
    code: `CF-${1000 + data.bookings.length + 1}`,
    chef_id: win.chef_id,
    customer: order.customer,
    service: order.service,
    address: order.address ?? "",
    region: order.region,
    location: order.location,
    guests: order.guests,
    scheduled_start: order.scheduled_start,
    scheduled_end: order.scheduled_end,
    actual_in: null,
    actual_out: null,
    status: "upcoming",
    base_amount: win.amount,
    overtime_rate: order.overtime_rate,
    overtime_amount: 0,
    dish_ids: order.dish_ids,
    notes: order.notes,
    order_id: order.id,
    deposit_amount: deposit,
  });
  Object.assign(order, {
    status: "confirmed",
    deposit_amount: deposit,
    deposit_ref: `SIM-${order.code}`,
    deposit_paid_at: new Date().toISOString(),
    booking_id: bookingId,
  });
  saveLocal(data);
  return bookingId;
}
export async function cancelOrder(orderId: string) {
  if (supabase) return rpc("cancel_order", { p_order: orderId });
  const data = localData();
  requireManager(data);
  const order = localOrder(data, orderId);
  if (!["open", "awarded", "unfilled"].includes(order.status))
    throw new Error("Only an open, awarded or unfilled order can be cancelled.");
  order.status = "cancelled";
  saveLocal(data);
}
/** Approved chefs matching the filter, most experienced first (staff only). */
export async function searchChefs(
  filter: ChefFilter,
  limit = 20,
  offset = 0,
): Promise<Paged<ChefResult>> {
  if (filter.start && filter.end && Date.parse(filter.end) <= Date.parse(filter.start))
    throw new Error("The availability end must be after its start.");
  if (supabase)
    return pagedRpc<ChefResult>("search_chefs", {
      p_filter: filter,
      p_limit: limit,
      p_offset: offset,
    });
  const data = localData();
  requireManager(data);
  return page(
    data.profiles
      .filter((p) =>
        matchesChefFilter(p, filter, (id) => chefBusy(data, id, filter.start, filter.end)),
      )
      .sort((a, b) => b.experience - a.experience || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(({ id, name, email, phone, chef_type, experience, cuisine, region, location, online }) => ({
        id, name, email, phone, chef_type: chef_type ?? "", experience, cuisine, region, location, online,
      })),
    limit,
    offset,
  );
}
