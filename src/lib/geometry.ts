import { Room } from "./types";

export interface BBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

// Bounding box (in meters) covering all rooms — used as a stable
// reference frame for mapping room coordinates onto the floor plan image.
export function computeRoomsBBox(rooms: Room[]): BBox {
  if (rooms.length === 0) return { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    minZ = Math.min(minZ, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxZ = Math.max(maxZ, r.y + r.h);
  }
  if (maxX - minX < 1e-6) maxX = minX + 1;
  if (maxZ - minZ < 1e-6) maxZ = minZ + 1;
  return { minX, minZ, maxX, maxZ };
}
