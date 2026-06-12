"use client";

import { useEffect, useRef, useState } from "react";
import { Room } from "@/lib/types";
import { BBox } from "@/lib/geometry";
import { ROOM_COLORS } from "@/lib/colors";

interface FloorPlan2DEditorProps {
  imageUrl: string;
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onUpdateRoom: (room: Room) => void;
  bbox: BBox | null;
}

type DragMode = "move" | "resize";

// Resize handle directions: 4 corners + 4 edges (Excel-like)
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface DragState {
  id: string;
  mode: DragMode;
  dir?: ResizeDir;
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const MIN_SIZE = 0.5;

const round1 = (n: number) => parseFloat(n.toFixed(1));

const toHexColor = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const RESIZE_HANDLES: { dir: ResizeDir; top: string; left: string; cursor: string }[] = [
  { dir: "nw", top: "0%", left: "0%", cursor: "nwse-resize" },
  { dir: "n", top: "0%", left: "50%", cursor: "ns-resize" },
  { dir: "ne", top: "0%", left: "100%", cursor: "nesw-resize" },
  { dir: "e", top: "50%", left: "100%", cursor: "ew-resize" },
  { dir: "se", top: "100%", left: "100%", cursor: "nwse-resize" },
  { dir: "s", top: "100%", left: "50%", cursor: "ns-resize" },
  { dir: "sw", top: "100%", left: "0%", cursor: "nesw-resize" },
  { dir: "w", top: "50%", left: "0%", cursor: "ew-resize" },
];

export default function FloorPlan2DEditor({
  imageUrl,
  rooms,
  selectedRoomId,
  onSelectRoom,
  onUpdateRoom,
  bbox,
}: FloorPlan2DEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const roomsRef = useRef<Room[]>(rooms);
  const onUpdateRoomRef = useRef(onUpdateRoom);
  const bboxRef = useRef<BBox | null>(bbox);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { onUpdateRoomRef.current = onUpdateRoom; }, [onUpdateRoom]);
  useEffect(() => { bboxRef.current = bbox; }, [bbox]);

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
        const dir = drag.dir!;
        let { x, y, w, h } = drag.orig;

        if (dir.includes("e")) {
          w = Math.max(MIN_SIZE, drag.orig.w + dxMeters);
        }
        if (dir.includes("w")) {
          w = Math.max(MIN_SIZE, drag.orig.w - dxMeters);
          x = drag.orig.x + (drag.orig.w - w);
        }
        if (dir.includes("s")) {
          h = Math.max(MIN_SIZE, drag.orig.h + dyMeters);
        }
        if (dir.includes("n")) {
          h = Math.max(MIN_SIZE, drag.orig.h - dyMeters);
          y = drag.orig.y + (drag.orig.h - h);
        }

        onUpdateRoomRef.current({
          ...room,
          x: round1(x),
          y: round1(y),
          w: round1(w),
          h: round1(h),
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

  const startDrag = (e: React.MouseEvent, room: Room, mode: DragMode, dir?: ResizeDir) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectRoom(room.id);
    dragRef.current = {
      id: room.id,
      mode,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: room.x, y: room.y, w: room.w, h: room.h },
    };
    forceRender((v) => v + 1);
  };

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
              {RESIZE_HANDLES.map((handle) => (
                <div
                  key={handle.dir}
                  onMouseDown={(e) => startDrag(e, room, "resize", handle.dir)}
                  style={{
                    position: "absolute",
                    top: handle.top,
                    left: handle.left,
                    width: 10,
                    height: 10,
                    transform: "translate(-50%, -50%)",
                    background: color,
                    border: "1px solid white",
                    cursor: handle.cursor,
                    boxSizing: "border-box",
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
