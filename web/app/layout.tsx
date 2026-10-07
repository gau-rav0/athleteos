import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AthleteOS — Your training, understood",
  description: "Private athlete intelligence. Experimental dashboard preview.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
