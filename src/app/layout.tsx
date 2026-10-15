import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "WebSend — Fast, Private Peer-to-Peer File Transfer",
  description:
    "Send files between phones, laptops, and PCs directly in your browser. No apps, no accounts, encrypted & peer-to-peer.",
  keywords: ["file sharing", "p2p transfer", "webrtc", "airdrop alternative", "localsend alternative"],
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col selection:bg-[#FBECE3] selection:text-[#C45F2C]">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "#FFFFFF",
              color: "#2C1A11",
              border: "1px solid #EDE2D3",
              borderRadius: "1rem",
              boxShadow: "0 10px 25px -5px rgba(44, 26, 17, 0.1)",
              fontFamily: "inherit",
            },
          }}
        />
      </body>
    </html>
  );
}
