// Client-side only: exports top-down floor plan as PDF
import * as THREE from "three";
import type { Room } from "./types";

const ROOM_COLORS = [
  0x4a9eff, 0xff6b6b, 0x51cf66, 0xffd43b, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x74c0fc, 0xa9e34b,
];

async function buildTopDownImage(rooms: Room[]): Promise<string> {
  const W = 800;
  const H = 600;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setClearColor(0xffffff, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.4));

  rooms.forEach((room, idx) => {
    const geo = new THREE.BoxGeometry(room.w, room.wallHeight, room.h);
    const color = ROOM_COLORS[idx % ROOM_COLORS.length];
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.88 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);
    mesh.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 })
      )
    );
    scene.add(mesh);
  });

  // Compute scene bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  rooms.forEach((r) => {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.w);
    minZ = Math.min(minZ, r.y);
    maxZ = Math.max(maxZ, r.y + r.h);
  });
  if (!isFinite(minX)) { minX = 0; maxX = 10; minZ = 0; maxZ = 10; }

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 1) + 4;
  const aspect = W / H;

  const cam = new THREE.OrthographicCamera(
    cx - (span * aspect) / 2,
    cx + (span * aspect) / 2,
    cz + span / 2,
    cz - span / 2,
    0.1,
    1000
  );
  cam.position.set(cx, 100, cz);
  cam.lookAt(cx, 0, cz);
  cam.up.set(0, 0, -1);
  cam.updateProjectionMatrix();

  renderer.render(scene, cam);
  const imgData = renderer.domElement.toDataURL("image/png");

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
  renderer.dispose();

  return imgData;
}

export async function exportFloorPlanPdf(rooms: Room[], note?: string | null): Promise<void> {
  const threeImgData = await buildTopDownImage(rooms);

  const VIEW_W = 800;
  const VIEW_H = 600;
  const LEGEND_W = 270;
  const TOTAL_W = VIEW_W + LEGEND_W;

  const canvas = document.createElement("canvas");
  canvas.width = TOTAL_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TOTAL_W, VIEW_H);

  // Three.js top-down view
  const img = new Image();
  img.src = threeImgData;
  await new Promise<void>((resolve) => { img.onload = () => resolve(); });
  ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);

  // Divider
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(VIEW_W, 0);
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.stroke();

  // Legend header
  const LX = VIEW_W + 20;
  ctx.fillStyle = "#111111";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("部屋一覧", LX, 36);

  if (note) {
    ctx.fillStyle = "#666666";
    ctx.font = "13px sans-serif";
    ctx.fillText(note, LX, 58);
  }

  const startY = note ? 82 : 68;
  rooms.forEach((room, i) => {
    const y = startY + i * 38;
    if (y > VIEW_H - 10) return;

    const color = ROOM_COLORS[i % ROOM_COLORS.length];
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(LX, y - 14, 18, 18);
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(LX, y - 14, 18, 18);

    ctx.fillStyle = "#111111";
    ctx.font = "14px sans-serif";
    ctx.fillText(room.name, LX + 26, y);

    ctx.fillStyle = "#555555";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      `${room.w}m × ${room.h}m = ${(room.w * room.h).toFixed(1)}㎡`,
      LX + 26,
      y + 16
    );
  });

  // Total area footer
  const totalArea = rooms.reduce((s, r) => s + r.w * r.h, 0);
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LX, VIEW_H - 40);
  ctx.lineTo(LX + LEGEND_W - 30, VIEW_H - 40);
  ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(`合計：${totalArea.toFixed(1)}㎡`, LX, VIEW_H - 22);

  const combinedImgData = canvas.toDataURL("image/png");

  // Embed in PDF (landscape A4)
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  const imgAspect = TOTAL_W / VIEW_H;
  let drawW = pdfW - 20;
  let drawH = drawW / imgAspect;
  if (drawH > pdfH - 20) {
    drawH = pdfH - 20;
    drawW = drawH * imgAspect;
  }

  pdf.addImage(combinedImgData, "PNG", 10, 10, drawW, drawH);
  pdf.save(`madoriz_${Date.now()}.pdf`);
}
