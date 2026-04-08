import type { Metadata } from "next";
import { Pacifico, Roboto_Mono } from "next/font/google";
import "./globals.css";

const pacifico = Pacifico({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const robotoMono = Roboto_Mono({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://voicecast.lever-labs.com"),
  title: "VoiceCast — AI Podcast Generator",
  description:
    "Type a topic, get a full AI-generated podcast with two hosts and custom-designed voices in about a minute. Powered by ElevenLabs.",
  openGraph: {
    title: "VoiceCast — Type a topic. Get a podcast.",
    description:
      "AI hosts, custom-designed voices, full episode in 60 seconds. Built on ElevenLabs.",
    type: "website",
    url: "https://voicecast.lever-labs.com",
    siteName: "VoiceCast",
  },
  twitter: {
    card: "summary_large_image",
    title: "VoiceCast — Type a topic. Get a podcast.",
    description:
      "AI hosts, custom-designed voices, full episode in 60 seconds. Built on ElevenLabs.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${pacifico.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
