// Indian mobile numbers only (MSG91 DLT). The canonical form is the one MSG91
// takes as a widget identifier: "91" + 10 digits, no "+". Must stay in step
// with public.mobile_key in supabase/migrations/202609260001_sms_login.sql.
export function normalizeMobile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const d = input.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  return null;
}

/** "+91 •••••• 3210" for messages. */
export function maskMobile(mobile: string): string {
  return `+91 •••••• ${mobile.slice(-4)}`;
}
