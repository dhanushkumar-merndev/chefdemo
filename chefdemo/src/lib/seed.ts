import { Bid, Booking, Data, Marketplace, Order, Profile, ServiceArea } from "./domain";

export const demoChef = "10000000-0000-4000-8000-000000000001";
export const demoAdmin = "10000000-0000-4000-8000-000000000002";
const areaList: [string, string][] = [
  ["Bengaluru", "All locations"],
  ["Bengaluru", "Koramangala"],
  ["Bengaluru", "Indiranagar"],
  ["Bengaluru", "Whitefield"],
  ["Bengaluru", "HSR Layout"],
  ["Bengaluru", "Jayanagar"],
  ["Chennai", "All locations"],
  ["Chennai", "Adyar"],
  ["Chennai", "Anna Nagar"],
  ["Delhi", "NCR"],
  ["Delhi", "All locations"],
  ["Hyderabad", "All locations"],
  ["Hyderabad", "Gachibowli"],
  ["Mumbai", "All locations"],
  ["Mumbai", "Bandra"],
  ["Rajasthan", "All locations"],
];
export function seedData(): Data & Marketplace {
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
  const chef = (
    i: number,
    name: string,
    region: string,
    location: string,
    chef_type: Profile["chef_type"],
    experience: number,
    online: boolean,
    cuisine: string,
  ): Profile => ({
    id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@chefflow.demo`,
    role: "chef",
    phone: "",
    cuisine,
    experience,
    online,
    region,
    location,
    chef_type,
  });
  const otherChefs = [
    chef(3, "Meera Iyer", "Bengaluru", "All locations", "home_cook", 4, true, "South Indian home food"),
    chef(4, "Kabir Singh", "Bengaluru", "Whitefield", "tandoor_specialist", 12, false, "Tandoor & grills"),
    chef(5, "Farah Khan", "Mumbai", "Bandra", "caterer", 10, true, "Mughlai catering"),
    chef(6, "Dev Malhotra", "Delhi", "NCR", "baker", 6, true, "Breads & desserts"),
  ];
  const [meera] = otherChefs;
  const order = (
    i: number,
    customer: string,
    location: string,
    startMins: number,
    deadlineMins: number,
    status: Order["status"],
    max_budget: number | null,
  ): Order => ({
    id: `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    code: `OR-${1000 + i}`,
    customer,
    service: "Private dinner",
    address: `${location}, Bengaluru`,
    region: "Bengaluru",
    location,
    guests: 10,
    scheduled_start: iso(startMins),
    scheduled_end: iso(startMins + 180),
    bid_deadline: iso(deadlineMins),
    overtime_rate: 300,
    max_budget,
    dish_ids: dishes.slice(0, 2).map((d) => d.id),
    notes: "Family dinner; mild spice please.",
    status,
    winning_bid_id: null,
    deposit_amount: 0,
    deposit_ref: null,
    deposit_paid_at: null,
    booking_id: null,
    created_at: iso(-600 + i),
  });
  const bid = (
    i: number,
    order_id: string,
    chef_id: string,
    amount: number,
    status: Bid["status"],
    mins: number,
  ): Bid => ({
    id: `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    order_id,
    chef_id,
    amount,
    message: "",
    status,
    created_at: iso(mins),
    updated_at: iso(mins),
  });
  // Open: Meera has bid; the demo chef can still undercut her.
  const open = order(1, "Kavya Rao", "Koramangala", 7200, 2880, "open", 5000);
  // Awarded to Meera at the deadline; the client's deposit is still due.
  const awarded = order(2, "Aditya Menon", "Indiranagar", 4320, -60, "awarded", null);
  // Confirmed: the deposit was paid and the demo chef assigned (booking 3).
  const booked = booking(3, "Rohan Mehta", 1440, "upcoming", 1750);
  const confirmed = {
    ...order(3, "Rohan Mehta", booked.location, 1440, -300, "confirmed", null),
    service: booked.service,
    address: booked.address,
    guests: booked.guests,
    scheduled_start: booked.scheduled_start,
    scheduled_end: booked.scheduled_end,
    deposit_amount: 350,
    deposit_ref: "SIM-OR-1003",
    deposit_paid_at: iso(-290),
    booking_id: booked.id,
  };
  booked.order_id = confirmed.id;
  booked.deposit_amount = 350;
  const bids = [
    bid(1, open.id, meera.id, 3600, "active", -240),
    bid(2, awarded.id, meera.id, 2800, "won", -400),
    bid(3, awarded.id, demoChef, 3000, "lost", -380),
    bid(4, confirmed.id, demoChef, 1750, "won", -700),
  ];
  awarded.winning_bid_id = bids[1].id;
  confirmed.winning_bid_id = bids[3].id;
  return {
    orders: [open, awarded, confirmed],
    bids,
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
        chef_type: "professional_chef",
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
      ...otherChefs,
    ],
    dishes,
    bookings: [
      booking(1, "Riya Malhotra", 60, "upcoming", 2400),
      booking(2, "Neha Sharma", 240, "requested", 3200),
      booked,
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
