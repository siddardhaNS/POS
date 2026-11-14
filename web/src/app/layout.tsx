import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ErrorReporter } from "@/components/error-reporter";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Tiffin: the restaurant POS that keeps up with the rush", template: "%s · Tiffin" },
  description:
    "Tiffin is the restaurant operating system for dine-in, delivery and back office. Tables, kitchen display, online orders, payments and reports on the devices you already own. Start a free trial.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${display.variable}`}>
      <body className="antialiased">
        {children}
        <Toaster position="bottom-center" />
        <ErrorReporter />
      </body>
    </html>
  );
}
