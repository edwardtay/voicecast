import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("audio") as File[];

    if (files.length === 0) {
      return Response.json({ error: "No audio file provided" }, { status: 400 });
    }

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

    // Clone the voice
    const result = await elevenlabs.voices.ivc.create({
      name: `VoiceCast-${Date.now()}`,
      files,
      removeBackgroundNoise: true,
      description: "Voice cloned for VoiceCast podcast",
      labels: { source: "voicecast" },
    });

    // Generate a test phrase with the cloned voice so user can verify quality
    let previewBase64: string | undefined;
    try {
      const previewStream = await elevenlabs.textToSpeech.convert(
        result.voiceId,
        {
          text: "Hey there! This is what I sound like as a podcast host. Pretty cool, right?",
          modelId: "eleven_multilingual_v2",
        }
      );
      const chunks: Uint8Array[] = [];
      const reader = (previewStream as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      previewBase64 = Buffer.concat(chunks).toString("base64");
    } catch {
      // Preview failed — clone still succeeded, just no preview
    }

    return Response.json({
      voiceId: result.voiceId,
      previewBase64,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
