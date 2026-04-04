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
  title: "VoiceCast — AI Podcast Generator",
  description:
    "Enter any topic and get a full AI-generated podcast with unique designed voices. Powered by ElevenLabs Voice Design API.",
  openGraph: {
    title: "VoiceCast — AI Podcast Generator",
    description:
      "Enter any topic and get a full AI-generated podcast with unique designed voices.",
    type: "website",
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
