export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wallHeight: number;
}

export interface FloorPlanModel {
  id: string;
  rooms: Room[];
  image_url: string | null;
  note: string | null;
  created_at: string;
}

export interface AnalyzeResponse {
  rooms: Omit<Room, "id">[];
  note: string;
}
