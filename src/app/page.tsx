"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import FileUpload from "@/components/FileUpload";
import EditPanel from "@/components/EditPanel";
import RoomLegend from "@/components/RoomLegend";
import { Room } from "@/lib/types";
import { uploadFloorPlanImage } from "@/lib/supabase";
import { renderPdfPageToBase64 } from "@/lib/pdf-utils";
import { exportFloorPlanPdf } from "@/lib/export-pdf";

const ThreeViewer = dynamic(() => import("@/components/ThreeViewer"), { ssr: false });

let nextId = 1;
const uid = () => `room-${Date.now()}-${nextId++}`;

export default function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    setShareUrl(null);
    try {
      // Always upload the original file (PDF or image) to Supabase Storage
      const url = await uploadFloorPlanImage(file);
      setImageUrl(url);

      // For PDF: render page 1 to PNG client-side, send base64 to analyze
      // For images: send the Supabase URL as-is
      type AnalyzePayload =
        | { imageUrl: string }
        | { imageBase64: string; mediaType: string };

      let payload: AnalyzePayload;
      if (file.type === "application/pdf") {
        const imageBase64 = await renderPdfPageToBase64(file);
        payload = { imageBase64, mediaType: "image/png" };
      } else {
        payload = { imageUrl: url };
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");

      const analyzedRooms: Room[] = (data.rooms || []).map(
        (r: Omit<Room, "id">) => ({ ...r, id: uid() })
      );
      setRooms(analyzedRooms);
      setNote(data.note || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRoom = useCallback((updated: Room) => {
    setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const handleAddRoom = useCallback(() => {
    setRooms((prev) => {
      const newRoom: Room = {
        id: uid(),
        name: `部屋${prev.length + 1}`,
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        wallHeight: 2.4,
      };
      return [...prev, newRoom];
    });
  }, []);

  const handleDeleteRoom = useCallback((id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setSelectedRoomId((prev) => (prev === id ? null : prev));
  }, []);

  const handleMoveRoom = useCallback((id: string, x: number, y: number) => {
    setRooms((prev) =>
      prev.map((r) => (r.id === id ? { ...r, x, y } : r))
    );
  }, []);

  const handleSave = async () => {
    if (rooms.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms, image_url: imageUrl, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setShareUrl(`${window.location.origin}/model/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPdf = async () => {
    if (rooms.length === 0) return;
    setExporting(true);
    try {
      await exportFloorPlanPdf(rooms, note || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF出力に失敗しました");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-gray-900">間取り図 3Dビジュアライザー</h1>
          <p className="text-xs text-gray-500">間取り図をアップロードしてAIで3D表示</p>
        </div>
        {rooms.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              disabled={exporting}
              className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {exporting ? "出力中..." : "平面図をPDFで出力"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存して共有URLを発行"}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {shareUrl && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-green-800 font-medium">共有URL:</span>
          <span className="text-green-700 font-mono truncate flex-1">{shareUrl}</span>
          <button
            onClick={handleCopy}
            className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 transition-colors flex-shrink-0"
          >
            {copied ? "コピー済" : "コピー"}
          </button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-700 underline text-xs flex-shrink-0"
          >
            開く
          </a>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden">
        {rooms.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-md">
              <FileUpload onFile={handleFile} loading={loading} />
            </div>
          </div>
        ) : (
          <>
            <div className="w-72 lg:w-80 border-r border-gray-200 flex flex-col overflow-hidden bg-white">
              <EditPanel
                rooms={rooms}
                selectedRoomId={selectedRoomId}
                onSelectRoom={setSelectedRoomId}
                onUpdateRoom={handleUpdateRoom}
                onAddRoom={handleAddRoom}
                onDeleteRoom={handleDeleteRoom}
              />
              <div className="border-t border-gray-200 p-3">
                <button
                  onClick={() => {
                    setRooms([]);
                    setImageUrl(null);
                    setShareUrl(null);
                    setSelectedRoomId(null);
                  }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
                >
                  別の間取り図を読み込む
                </button>
              </div>
            </div>

            <div className="flex-1 relative">
              <ThreeViewer
                rooms={rooms}
                selectedRoomId={selectedRoomId}
                onSelectRoom={setSelectedRoomId}
                onMoveRoom={handleMoveRoom}
              />
              <RoomLegend rooms={rooms} note={note} />
              <div className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm rounded-md px-2 py-1 text-xs text-gray-500">
                クリック：選択　ドラッグ：移動　スクロール：ズーム
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
