import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebSend — Send files between devices",
  description:
    "Send files between phones, laptops, and PCs directly in your browser. No apps, no accounts, encrypted & peer-to-peer.",
  keywords: ["file sharing", "p2p transfer", "webrtc", "airdrop alternative", "localsend alternative"],
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
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
