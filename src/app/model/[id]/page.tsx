"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import RoomLegend from "@/components/RoomLegend";
import { FloorPlanModel } from "@/lib/types";
import { computeRoomsBBox } from "@/lib/geometry";

const ThreeViewer = dynamic(() => import("@/components/ThreeViewer"), { ssr: false });

export default function ModelPage({ params }: { params: { id: string } }) {
  const [model, setModel] = useState<FloorPlanModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/models/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setModel(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  // Frozen bbox computed once from the saved room layout — stable coordinate
  // reference frame for cropping floor textures from the floor plan image.
  const bbox = useMemo(
    () => (model && model.rooms.length > 0 ? computeRoomsBBox(model.rooms) : null),
    [model]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <p className="text-gray-500 animate-pulse">読み込み中...</p>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <p className="text-red-500 mb-2">モデルが見つかりません</p>
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
        <h1 className="text-base font-bold text-gray-900">間取り図 3Dビュー</h1>
        <p className="text-xs text-gray-400">
          {model.rooms.length}部屋　／　作成日:{" "}
          {new Date(model.created_at).toLocaleDateString("ja-JP")}
        </p>
      </header>

      <div className="flex-1 relative">
        <ThreeViewer
          rooms={model.rooms}
          selectedRoomId={null}
          onSelectRoom={() => {}}
          onMoveRoom={() => {}}
          readonly
          floorPlanImageUrl={model.image_url}
          bbox={bbox}
        />
        <RoomLegend rooms={model.rooms} note={model.note} />
        <div className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm rounded-md px-2 py-1 text-xs text-gray-500">
          ドラッグ：回転　スクロール：ズーム
        </div>
      </div>
    </div>
  );
}
