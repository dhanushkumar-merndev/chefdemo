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
  email: string;
  approval_status?: "pending" | "approved" | "rejected";
  role: Role;
  phone: string;
  cuisine: string;
  experience: number;
  online: boolean;
  region: string;
  location: string;
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
