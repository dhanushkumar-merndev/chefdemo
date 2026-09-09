import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChefFlow | Chef Partner",
  description:
    "Your kitchen. Your schedule. Your growth. Manage chef services, attendance, menus and kitchen updates.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
