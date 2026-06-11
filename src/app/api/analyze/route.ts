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
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      temperature: 0,
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

手順:
1. まず、間取り図に書かれている部屋名・スペース名のラベル（リビング、ダイニング、キッチン、洋室、和室、トイレ、浴室、洗面所、玄関、廊下、クローゼット、収納、バルコニーなど）をすべて読み取る。
2. ラベルごとに、対応する区画を1つの部屋として抽出する。トイレと浴室のように隣接していても別々のラベルがある場合は、必ず別々の部屋として分離すること（1つの矩形にまとめない）。
3. 建物の外壁の内側にある部屋・区画のみを対象とする。庭、駐車場、外構、敷地内の屋外スペースなど、建物の外側にあるものは含めない。

ルール:
- 間取り図に記載されている寸法線（例: 910, 1820, 2730 などmm単位の数値）を読み取り、それを基準に各部屋の位置とサイズ(x, y, w, h)を正確にメートル換算すること。
- 各部屋の矩形は、間取り図上の壁の内側の実寸と一致させること。隣接する部屋同士は壁を共有し、隙間なく・互いに重ならないように配置すること（壁の厚みは無視してよい）。
- 座標はメートル単位、x/yは矩形の左上を原点（間取り図全体の左上が(0,0)）とする。
- 説明文は不要。JSONのみを返すこと。

例：{"rooms":[{"name":"リビング","x":0,"y":0,"w":5.4,"h":4.2,"wallHeight":2.4},{"name":"トイレ","x":5.4,"y":0,"w":1.0,"h":1.6,"wallHeight":2.4}],"note":"3LDK想定"}`,
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
