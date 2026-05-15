import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, imageBase64, mediaType: clientMediaType } = await req.json();

    if (!imageUrl && !imageBase64) {
      return NextResponse.json({ error: "imageUrl or imageBase64 is required" }, { status: 400 });
    }

    type SupportedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    let base64: string;
    let mediaType: SupportedMediaType;

    if (imageBase64) {
      // PDF converted to PNG on client side
      base64 = imageBase64;
      mediaType = (clientMediaType ?? "image/png") as SupportedMediaType;
    } else {
      // Fetch image from URL and convert to base64
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error("Failed to fetch image");
      const arrayBuffer = await res.arrayBuffer();
      base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentType = res.headers.get("content-type") || "image/jpeg";
      mediaType = contentType.split(";")[0] as SupportedMediaType;
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `添付の間取り図を解析し、各部屋の配置をJSON形式のみで返してください。
座標はメートル単位、x/yは左上原点、説明文は不要。
例：{"rooms":[{"name":"リビング","x":0,"y":0,"w":5.4,"h":4.2,"wallHeight":2.4}],"note":"3LDK想定"}`,
            },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
