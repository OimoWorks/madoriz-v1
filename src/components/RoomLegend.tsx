import { Room } from "@/lib/types";

const ROOM_COLORS = [
  "#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b", "#cc5de8",
  "#ff922b", "#20c997", "#f06595", "#74c0fc", "#a9e34b",
];

interface RoomLegendProps {
  rooms: Room[];
  note?: string | null;
}

export default function RoomLegend({ rooms, note }: RoomLegendProps) {
  return (
    <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-md p-3 max-w-[180px]">
      {note && (
        <p className="text-xs text-gray-500 mb-2 font-medium">{note}</p>
      )}
      <ul className="space-y-1">
        {rooms.map((room, idx) => (
          <li key={room.id} className="flex items-center gap-2 text-xs text-gray-700">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: ROOM_COLORS[idx % ROOM_COLORS.length] }}
            />
            <span className="truncate">{room.name}</span>
            <span className="text-gray-400 flex-shrink-0 ml-auto">
              {(room.w * room.h).toFixed(1)}㎡
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
