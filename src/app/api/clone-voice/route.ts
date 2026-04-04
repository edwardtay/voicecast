import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 });
    }

    const elevenlabs = new ElevenLabsClient();

    const result = await elevenlabs.voices.ivc.create({
      name: `VoiceCast-Clone-${Date.now()}`,
      files: [audioFile],
      removeBackgroundNoise: true,
      description: "Voice cloned for VoiceCast podcast",
    });

    return Response.json({ voiceId: result.voiceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
