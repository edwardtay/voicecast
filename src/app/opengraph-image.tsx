import { ImageResponse } from "next/og";

export const alt = "VoiceCast — Type a topic. Get a podcast.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #1a1410 50%, #0a0a0a 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#fbbf24",
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            marginBottom: 28,
            fontWeight: 600,
          }}
        >
          VoiceCast
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 88,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.05,
            marginBottom: 36,
          }}
        >
          <span>Type a topic.</span>
          <span>Get a podcast.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "rgba(255,255,255,0.65)",
            textAlign: "center",
            maxWidth: 960,
          }}
        >
          AI hosts. Custom voices. Full episode in 60 seconds.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: "rgba(255,255,255,0.4)",
            marginTop: 72,
            letterSpacing: "0.05em",
          }}
        >
          Powered by ElevenLabs
        </div>
      </div>
    ),
    { ...size }
  );
}
