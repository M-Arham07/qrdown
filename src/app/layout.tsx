import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://qrdown.vercel.app";
const title = "QRDown — Air-Gapped Optical & P2P File Transfer";
const description =
  "Transfer files offline via animated QR codes or direct WebRTC peer-to-peer. Encrypted, instant, and air-gapped without accounts or cloud tracking.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | QRDown",
  },
  description,
  applicationName: "QRDown",
  authors: [{ name: "M-Arham07", url: "https://github.com/M-Arham07" }],
  creator: "M-Arham07",
  publisher: "QRDown",
  keywords: [
    "QRDown",
    "air-gapped file transfer",
    "optical data transfer",
    "offline file sharing",
    "animated qr codes",
    "qr file transfer",
    "webrtc p2p",
    "airdrop alternative",
    "localsend alternative",
    "browser file transfer",
    "encrypted file sharing",
    "zero install file transfer",
  ],
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    title,
    description,
    siteName: "QRDown",
    images: [
      {
        url: "/favicon.svg",
        width: 512,
        height: 512,
        alt: "QRDown Logo — Air-Gapped Optical & P2P File Transfer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@M_Arham07",
    images: ["/favicon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "W3wHC93KbFpQsD5atPpV-zi6dHE8U2dq4MeebPWJ-rE",
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090B",
  colorScheme: "light dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "QRDown",
  url: siteUrl,
  description,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "All",
  browserRequirements: "Requires WebRTC and Camera access (for optical mode)",
  author: {
    "@type": "Person",
    name: "M-Arham07",
    url: "https://github.com/M-Arham07",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta
          name="google-site-verification"
          content="W3wHC93KbFpQsD5atPpV-zi6dHE8U2dq4MeebPWJ-rE"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col selection:bg-[#EFF6FF] selection:text-[#1D4ED8]">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#FFFFFF",
              color: "#18181B",
              border: "1px solid #E4E4E7",
              borderRadius: "1rem",
              fontFamily: "inherit",
            },
          }}
        />
      </body>
    </html>
  );
}
