import { Booking, Data, ServiceArea } from "./domain";

export const demoChef = "10000000-0000-4000-8000-000000000001";
export const demoAdmin = "10000000-0000-4000-8000-000000000002";
const areaList: [string, string][] = [
  ["Bengaluru", "Koramangala"],
  ["Bengaluru", "Indiranagar"],
  ["Bengaluru", "Whitefield"],
  ["Bengaluru", "HSR Layout"],
  ["Bengaluru", "Jayanagar"],
  ["Chennai", "Adyar"],
  ["Chennai", "Anna Nagar"],
  ["Hyderabad", "Gachibowli"],
  ["Mumbai", "Bandra"],
];
export function seedData(): Data {
  const service_areas: ServiceArea[] = areaList.map(([region, name], i) => ({
    id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    region,
    name,
    active: true,
  }));
  const now = Date.now();
  const iso = (minutes: number) =>
    new Date(now + minutes * 60000).toISOString();
  const dishes = [
    ["Paneer butter masala", "North Indian", true],
    ["Dal makhani", "North Indian", true],
    ["Butter naan", "North Indian", true],
    ["Vegetable biryani", "South Indian", true],
    ["Masala dosa", "South Indian", true],
    ["Chicken chettinad", "South Indian", false],
    ["Pasta primavera", "Italian", true],
    ["Tiramisu", "Italian", true],
  ].map(([name, cuisine, vegetarian], i) => ({
    id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    name: String(name),
    cuisine: String(cuisine),
    vegetarian: Boolean(vegetarian),
    active: true,
  }));
  const booking = (
    i: number,
    customer: string,
    mins: number,
    status: Booking["status"],
    amount: number,
  ): Booking => ({
    id: `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    code: `CF-${1000 + i}`,
    chef_id: demoChef,
    customer,
    service: i === 3 ? "Italian lunch" : "Private dinner",
    address:
      ["Koramangala", "Whitefield", "Indiranagar", "HSR Layout"][i % 4] +
      ", Bengaluru",
    region: "Bengaluru",
    location: ["Koramangala", "Whitefield", "Indiranagar", "HSR Layout"][i % 4],
    guests: i === 3 ? 8 : 12,
    scheduled_start: iso(mins),
    scheduled_end: iso(mins + 180),
    actual_in: null,
    actual_out: null,
    status,
    base_amount: amount,
    overtime_rate: 300,
    overtime_amount: 0,
    dish_ids: dishes.slice(0, 3).map((d) => d.id),
    notes:
      "Please keep the food mildly spiced. All ingredients are available in the kitchen.",
  });
  const active = booking(4, "Imon Das", -210, "in_progress", 2200);
  active.actual_in = iso(-208);
  const complete = booking(5, "Hema Gupta", -1440, "completed", 2700);
  complete.actual_in = iso(-1440);
  complete.actual_out = iso(-1230);
  complete.overtime_amount = 150;
  return {
    profiles: [
      {
        id: demoChef,
        name: "Arjun Kapoor",
        email: "arjun@chefflow.demo",
        role: "chef",
        phone: "+91 98765 43210",
        cuisine: "North Indian & Mughlai",
        experience: 8,
        online: true,
        region: "Bengaluru",
        location: "Koramangala",
      },
      {
        id: demoAdmin,
        name: "Priya Sharma",
        email: "admin@chefflow.demo",
        role: "admin",
        phone: "",
        cuisine: "",
        experience: 0,
        online: true,
        region: "",
        location: "",
      },
    ],
    dishes,
    bookings: [
      booking(1, "Riya Malhotra", 60, "upcoming", 2400),
      booking(2, "Neha Sharma", 240, "requested", 3200),
      booking(3, "Rohan Mehta", 1440, "upcoming", 1750),
      active,
      complete,
    ],
    photos: [],
    reviews: [
      {
        id: "review-1",
        booking_id: complete.id,
        customer: "Hema Gupta",
        rating: 5,
        comment:
          "Arjun was punctual, very professional, and the food was exceptional.",
      },
    ],
    tickets: [],
    staff_access: [],
    service_areas,
  };
}
