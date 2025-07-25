import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";

const groq = new Groq();

const schema = zfd.formData({
  input: z.union([zfd.text(), zfd.file()]),
  message: zfd.repeatableOfType(
    zfd.json(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
  ),
});

export async function POST(request: Request) {
  const requestId = request.headers.get("x-vercel-id") || "local";

  console.time("transcribe " + requestId);

  const { data, success } = schema.safeParse(await request.formData());
  if (!success) return new Response("Invalid request", { status: 400 });

  const transcript = await getTranscript(data.input);
  if (!transcript) return new Response("Invalid audio", { status: 400 });

  console.timeEnd("transcribe " + requestId);

  // Extract user ID from Bearer token for logging in Supabase
  let userId = "anonymous"; // fallback user ID
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      userId = user.id;
    }
  }

  // Log user voice input to Supabase messages table
  try {
    await supabase.from("messages").insert({
      user_id: userId,
      role: "user",
      content: transcript,
      timestamp: new Date().toISOString(),
      source: "voice",
    });
  } catch (e) {
    console.warn("⚠️ Could not log user message to Supabase:", e);
  }

  // Generate assistant reply with Groq LLM
  console.time("text completion " + requestId);

  const completion = await groq.chat.completions.create({
    model: "llama3-8b-8192",
    messages: [
      {
        role: "system",
        content: `- You are Swift, a friendly and helpful voice assistant.
        - Respond briefly to the user's request, and do not provide unnecessary information.
        - If you don't understand the user's request, ask for clarification.
        - You do not have access to up-to-date information, so you should not provide real-time data.
        - You are not capable of performing actions other than responding to the user.
        - Do not use markdown, emojis, or other formatting in your responses. Respond in a way easily spoken by text-to-speech software.
        - User location is ${await location()}.
        - The current time is ${await time()}.
        - Your large language model is Llama 3, created by Meta, the 8 billion parameter version. It is hosted on Groq, an AI infrastructure company that builds fast inference technology.
        - Your text-to-speech model is Sonic, created and hosted by Cartesia, a company that builds fast and realistic speech synthesis technology.
        - You are built with Next.js and hosted on Vercel.`,
      },
      ...data.message,
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const response = completion.choices[0].message.content;
  console.timeEnd("text completion " + requestId);

  if (!response) return new Response("Invalid response", { status: 500 });

  // Log assistant response to Supabase messages table
  try {
    await supabase.from("messages").insert({
      user_id: userId,
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
      source: "assistant",
    });
  } catch (e) {
    console.warn("⚠️ Could not log assistant message to Supabase:", e);
  }

  // Synthesize speech with Cartesia Sonic
  console.time("cartesia request " + requestId);

  const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Cartesia-Version": "2024-06-30",
      "Content-Type": "application/json",
      "X-API-Key": process.env.CARTESIA_API_KEY!,
    },
    body: JSON.stringify({
      model_id: "sonic-english",
      transcript: response,
      voice: {
        mode: "id",
        id: "79a125e8-cd45-4c13-8a67-188112f4dd22",
      },
      output_format: {
        container: "raw",
        encoding: "pcm_f32le",
        sample_rate: 24000,
      },
    }),
  });

  console.timeEnd("cartesia request " + requestId);

  if (!voice.ok) {
    console.error(await voice.text());
    return new Response("Voice synthesis failed", { status: 500 });
  }

  // Stream audio response
  console.time("stream " + requestId);
  after(() => {
    console.timeEnd("stream " + requestId);
  });

  return new Response(voice.body, {
    headers: {
      "X-Transcript": encodeURIComponent(transcript),
      "X-Response": encodeURIComponent(response),
    },
  });
}

// --- Utility functions ---
async function location() {
  const headersList = await headers();
  const country = headersList.get("x-vercel-ip-country");
  const region = headersList.get("x-vercel-ip-country-region");
  const city = headersList.get("x-vercel-ip-city");
  if (!country || !region || !city) return "unknown";
  return `${city}, ${region}, ${country}`;
}

async function time() {
  const headersList = await headers();
  const timeZone = headersList.get("x-vercel-ip-timezone") || undefined;
  return new Date().toLocaleString("en-US", { timeZone });
}

async function getTranscript(input: string | File) {
  if (typeof input === "string") return input;

  try {
    const { text } = await groq.audio.transcriptions.create({
      file: input,
      model: "whisper-large-v3",
    });
    return text.trim() || null;
  } catch {
    return null;
  }
}
