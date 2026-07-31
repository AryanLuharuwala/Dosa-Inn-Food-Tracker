import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import SiteSidebar from "@/components/nav/SiteSidebar";
import { SidebarProvider } from "@/components/nav/SidebarContext";

export const metadata: Metadata = {
  title: "Rocky Da Adda | 100% Pure Veg Campus Restaurant",
  description: "Mess ka trauma is real. Food shouldn't be. Order delicious vegetarian food at IIT Kharagpur's favorite adda.",
  keywords: ["vegetarian", "campus food", "IIT Kharagpur", "food ordering", "restaurant"],
  authors: [{ name: "Rocky Da Adda" }],
  openGraph: {
    title: "Rocky Da Adda | 100% Pure Veg",
    description: "Mess ka trauma is real. Food shouldn't be.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a4d2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>
          <SidebarProvider>
            <SiteSidebar />
            {children}
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
