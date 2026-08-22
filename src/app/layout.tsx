import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

// IBM Plex, as the design uses: the sans for anything he says, the mono for
// every label, reading and number.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Axis",
  description: "Your personal AI assistant.",
  manifest: "/manifest.webmanifest",
  // So an installed window and an iPhone home-screen icon both look right.
  appleWebApp: { capable: true, title: "Axis", statusBarStyle: "black-translucent" },
  other: {
    // Next emits the modern `mobile-web-app-capable`. iOS before 15.4 only
    // understands the Apple-prefixed one, and without it a home-screen icon
    // opens in Safari with the address bar rather than as an app.
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#ff7a00",
  // Installed as an app, the page should fill the screen and stay put rather
  // than bouncing and zooming like a web page.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="ax-room min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
