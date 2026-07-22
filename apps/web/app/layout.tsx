import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-arabic",
  display: "swap", // paint text immediately with the fallback; swap when the webfont loads
  fallback: ["Segoe UI", "Tahoma", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "صيدلي — PharmaCRM",
  description: "نظام إدارة علاقات العملاء للصيدليات المصرية",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={ibmPlexArabic.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
