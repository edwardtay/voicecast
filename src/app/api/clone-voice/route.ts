import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("audio") as File[];

    if (files.length === 0) {
      return Response.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Validate file size (min 10KB, max 10MB per file)
    for (const file of files) {
      if (file.size < 10_000) {
        return Response.json(
          { error: "Audio too short. Record at least 10 seconds." },
          { status: 400 }
        );
      }
      if (file.size > 10_000_000) {
        return Response.json(
          { error: "File too large. Max 10MB per file." },
          { status: 400 }
        );
      }
    }

    const elevenlabs = new ElevenLabsClient();

    const result = await elevenlabs.voices.ivc.create({
      name: `VoiceCast-${Date.now()}`,
      files,
      removeBackgroundNoise: true,
      description: "Voice cloned for VoiceCast podcast",
      labels: {
        source: "voicecast",
      },
    });

    return Response.json({ voiceId: result.voiceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
