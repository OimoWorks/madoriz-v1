"use client";

import { Room } from "@/lib/types";

interface EditPanelProps {
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onUpdateRoom: (room: Room) => void;
  onAddRoom: () => void;
  onDeleteRoom: (id: string) => void;
}

export default function EditPanel({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onUpdateRoom,
  onAddRoom,
  onDeleteRoom,
}: EditPanelProps) {
  const update = (room: Room, field: keyof Room, value: string) => {
    const numFields = ["x", "y", "w", "h", "wallHeight"] as const;
    const isNum = numFields.includes(field as (typeof numFields)[number]);
    onUpdateRoom({
      ...room,
      [field]: isNum ? parseFloat(value) || 0 : value,
    });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800">部屋リスト</h2>
        <button
          onClick={onAddRoom}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
        >
          ＋ 部屋を追加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {rooms.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">
            部屋がありません
          </p>
        )}
        {rooms.map((room) => {
          const isSelected = room.id === selectedRoomId;
          return (
            <div
              key={room.id}
              className={`p-3 cursor-pointer transition-colors ${
                isSelected ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
              onClick={() => onSelectRoom(isSelected ? null : room.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <input
                  value={room.name}
                  onChange={(e) => update(room, "name", e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none w-full mr-2"
                  placeholder="部屋名"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRoom(room.id);
                  }}
                  className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none flex-shrink-0"
                  title="削除"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">幅 (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={room.w}
                    onChange={(e) => update(room, "w", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">奥行き (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={room.h}
                    onChange={(e) => update(room, "h", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">X座標 (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={room.x}
                    onChange={(e) => update(room, "x", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">Y座標 (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={room.y}
                    onChange={(e) => update(room, "y", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-xs text-gray-500">壁の高さ (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={room.wallHeight}
                    onChange={(e) => update(room, "wallHeight", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
