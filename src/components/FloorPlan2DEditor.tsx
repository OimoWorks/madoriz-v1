"use client";

import { useEffect, useRef, useState } from "react";
import { Room } from "@/lib/types";
import { computeRoomsBBox } from "@/lib/geometry";
import { ROOM_COLORS } from "@/lib/colors";

interface FloorPlan2DEditorProps {
  imageUrl: string;
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onUpdateRoom: (room: Room) => void;
}

type DragMode = "move" | "resize";

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const round1 = (n: number) => parseFloat(n.toFixed(1));

const toHexColor = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export default function FloorPlan2DEditor({
  imageUrl,
  rooms,
  selectedRoomId,
  onSelectRoom,
  onUpdateRoom,
}: FloorPlan2DEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const roomsRef = useRef<Room[]>(rooms);
  const onUpdateRoomRef = useRef(onUpdateRoom);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { onUpdateRoomRef.current = onUpdateRoom; }, [onUpdateRoom]);

  // Frozen bbox — stable reference frame mapping room coordinates (meters)
  // onto the floor plan image, independent of subsequent edits.
  const bboxRef = useRef<ReturnType<typeof computeRoomsBBox> | null>(null);
  if (rooms.length === 0) {
    bboxRef.current = null;
  } else if (!bboxRef.current) {
    bboxRef.current = computeRoomsBBox(rooms);
  }

  const [, forceRender] = useState(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const bbox = bboxRef.current;
      const container = containerRef.current;
      if (!drag || !bbox || !container) return;

      const rect = container.getBoundingClientRect();
      const bboxW = bbox.maxX - bbox.minX;
      const bboxH = bbox.maxZ - bbox.minZ;

      const dxMeters = ((e.clientX - drag.startX) / rect.width) * bboxW;
      const dyMeters = ((e.clientY - drag.startY) / rect.height) * bboxH;

      const room = roomsRef.current.find((r) => r.id === drag.id);
      if (!room) return;

      if (drag.mode === "move") {
        onUpdateRoomRef.current({
          ...room,
          x: round1(drag.orig.x + dxMeters),
          y: round1(drag.orig.y + dyMeters),
        });
      } else {
        onUpdateRoomRef.current({
          ...room,
          w: round1(Math.max(0.5, drag.orig.w + dxMeters)),
          h: round1(Math.max(0.5, drag.orig.h + dyMeters)),
        });
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent, room: Room, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectRoom(room.id);
    dragRef.current = {
      id: room.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: room.x, y: room.y, w: room.w, h: room.h },
    };
    forceRender((v) => v + 1);
  };

  const bbox = bboxRef.current;
  const bboxW = bbox ? bbox.maxX - bbox.minX : 1;
  const bboxH = bbox ? bbox.maxZ - bbox.minZ : 1;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-auto bg-gray-900 flex items-center justify-center"
      onClick={() => onSelectRoom(null)}
    >
      <div className="relative inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="floor plan" className="max-w-full max-h-[80vh] block" draggable={false} />
        {bbox && rooms.map((room, idx) => {
          const left = ((room.x - bbox.minX) / bboxW) * 100;
          const top = ((room.y - bbox.minZ) / bboxH) * 100;
          const width = (room.w / bboxW) * 100;
          const height = (room.h / bboxH) * 100;
          const color = toHexColor(ROOM_COLORS[idx % ROOM_COLORS.length]);
          const isSelected = room.id === selectedRoomId;

          return (
            <div
              key={room.id}
              onMouseDown={(e) => startDrag(e, room, "move")}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                border: `2px solid ${color}`,
                backgroundColor: `${color}33`,
                boxShadow: isSelected ? "inset 0 0 0 2px #ffffff" : undefined,
                cursor: "move",
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute top-0.5 left-1 text-xs font-medium px-1 rounded bg-black/50 text-white whitespace-nowrap"
                style={{ pointerEvents: "none" }}
              >
                {room.name}
              </span>
              <div
                onMouseDown={(e) => startDrag(e, room, "resize")}
                style={{
                  position: "absolute",
                  right: -4,
                  bottom: -4,
                  width: 12,
                  height: 12,
                  background: color,
                  border: "1px solid white",
                  cursor: "nwse-resize",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
