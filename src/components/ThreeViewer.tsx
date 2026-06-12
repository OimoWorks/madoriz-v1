"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Room } from "@/lib/types";
import { ROOM_COLORS } from "@/lib/colors";
import { BBox } from "@/lib/geometry";

const DEFAULT_UV = [0, 0, 1, 0, 1, 1, 0, 1];

// Crops the source floor-plan image to the pixel rectangle covered by this
// room (relative to the frozen layout bbox) at the time the room was first
// built. The resulting texture is fixed to the room — moving it later does
// not change which part of the floor plan it shows; resizing simply
// stretches the same cropped image over the new floor footprint (UVs stay 0-1).
function createRoomFloorTexture(
  room: Room,
  image: HTMLImageElement,
  bbox: BBox,
): THREE.CanvasTexture {
  const bboxW = bbox.maxX - bbox.minX;
  const bboxD = bbox.maxZ - bbox.minZ;
  const imageW = image.naturalWidth;
  const imageH = image.naturalHeight;

  const sx = Math.max(0, Math.min(imageW, ((room.x - bbox.minX) / bboxW) * imageW));
  const sy = Math.max(0, Math.min(imageH, ((room.y - bbox.minZ) / bboxD) * imageH));
  const sw = Math.max(1, Math.min(imageW - sx, (room.w / bboxW) * imageW));
  const sh = Math.max(1, Math.min(imageH - sy, (room.h / bboxD) * imageH));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Open-top box: floor (group 0) + 4 walls (group 1), default 0-1 UVs
function createOpenBoxGeo(w: number, wallHeight: number, h: number): THREE.BufferGeometry {
  const hw = w / 2, hh = wallHeight / 2, hd = h / 2;
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];

  const addQuad = (
    v0: [number, number, number], v1: [number, number, number],
    v2: [number, number, number], v3: [number, number, number],
    nx: number, ny: number, nz: number,
  ) => {
    const b = pos.length / 3;
    pos.push(...v0, ...v1, ...v2, ...v3);
    for (let i = 0; i < 4; i++) nor.push(nx, ny, nz);
    uvs.push(...DEFAULT_UV);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };

  // Floor: normal +Y
  addQuad([-hw, -hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [-hw, -hh, -hd], 0, 1, 0);
  // Wall +X
  addQuad([hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], 1, 0, 0);
  // Wall -X
  addQuad([-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], -1, 0, 0);
  // Wall +Z
  addQuad([-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], 0, 0, 1);
  // Wall -Z
  addQuad([hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], 0, 0, -1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  geo.addGroup(0, 6, 0);   // floor
  geo.addGroup(6, 24, 1);  // 4 walls
  return geo;
}

interface ThreeViewerProps {
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onMoveRoom: (id: string, x: number, y: number) => void;
  readonly?: boolean;
  floorPlanImageUrl?: string | null;
  bbox?: BBox | null;
}

export default function ThreeViewer({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onMoveRoom,
  readonly = false,
  floorPlanImageUrl = null,
  bbox = null,
}: ThreeViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const actionBtnRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const edgesMapRef = useRef<Map<string, THREE.LineSegments>>(new Map());
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const dragRoomIdRef = useRef<string | null>(null);
  // 'pending' = selected, showing ✓/✗ buttons; 'active' = drag enabled
  const moveModeRef = useRef<"pending" | "active" | null>(null);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const pointerDownPosRef = useRef({ x: 0, y: 0 });

  // Cached room metadata — skip geometry rebuild when dimensions unchanged
  const roomDimsRef = useRef<Map<string, { w: number; h: number; wh: number }>>(new Map());
  // Bounding box (meters) of all rooms, frozen at initial layout by the
  // parent and passed in as a prop — stable reference frame for cropping
  // each room's floor texture, shared with the 2D editor
  const layoutBBoxRef = useRef<BBox | null>(bbox);
  // Loaded floor-plan source image, used to crop per-room floor textures
  const floorImageRef = useRef<HTMLImageElement | null>(null);
  // Per-room cropped floor textures, created once and fixed to the room
  // (each room owns an independent texture)
  const roomCropMapRef = useRef<Map<string, THREE.CanvasTexture>>(new Map());
  const [imageVersion, setImageVersion] = useState(0);

  const roomsRef = useRef<Room[]>(rooms);
  const onSelectRoomRef = useRef(onSelectRoom);
  const onMoveRoomRef = useRef(onMoveRoom);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { onSelectRoomRef.current = onSelectRoom; }, [onSelectRoom]);
  useEffect(() => { onMoveRoomRef.current = onMoveRoom; }, [onMoveRoom]);

  // Keep the layout bbox in sync with the frozen value owned by the parent.
  // When it changes (e.g. becomes available after analysis), invalidate any
  // cached crops so floor textures are recropped against the correct bbox.
  useEffect(() => {
    layoutBBoxRef.current = bbox;
    roomCropMapRef.current.forEach((tex) => tex.dispose());
    roomCropMapRef.current.clear();
    setImageVersion((v) => v + 1);
  }, [bbox]);

  // Reset move mode when selection is cleared externally
  useEffect(() => {
    if (!selectedRoomId) {
      moveModeRef.current = null;
      dragRoomIdRef.current = null;
      if (actionBtnRef.current) actionBtnRef.current.style.display = "none";
    }
  }, [selectedRoomId]);

  const getCanvasPos = (clientX: number, clientY: number) => {
    const rect = mountRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  const buildRoom = useCallback((room: Room, roomIndex: number) => {
    const geo = createOpenBoxGeo(room.w, room.wallHeight, room.h);
    const roomColor = ROOM_COLORS[roomIndex % ROOM_COLORS.length];

    let floorMap: THREE.CanvasTexture | null = null;
    if (floorImageRef.current && layoutBBoxRef.current) {
      floorMap = createRoomFloorTexture(room, floorImageRef.current, layoutBBoxRef.current);
      roomCropMapRef.current.set(room.id, floorMap);
    }

    const floorMat = new THREE.MeshPhysicalMaterial({
      map: floorMap,
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      roughness: 0.3,
      metalness: 0.0,
      depthWrite: false,
    });
    const wallMat = new THREE.MeshPhysicalMaterial({
      color: roomColor,
      transparent: true,
      opacity: 0.15,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, [floorMat, wallMat]);
    mesh.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);
    mesh.userData.roomId = room.id;
    mesh.userData.colorIdx = roomIndex;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = roomIndex;

    const edges = new THREE.EdgesGeometry(geo);
    const lineSegs = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: roomColor, transparent: true, opacity: 0.6 }),
    );
    lineSegs.renderOrder = roomIndex + 0.5;
    mesh.add(lineSegs);

    roomDimsRef.current.set(room.id, { w: room.w, h: room.h, wh: room.wallHeight });

    return { mesh, lineSegs };
  }, []);

  // Initial scene setup
  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.Fog(0x05070d, 50, 140);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 1000);
    camera.position.set(10, 12, 15);
    camera.lookAt(5, 0, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = false;
    renderer.sortObjects = true;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x4060a0, 0.6));
    scene.add(new THREE.HemisphereLight(0x88aaff, 0x0a0e18, 0.5));

    const dirLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    dirLight.position.set(15, 28, 12);
    scene.add(dirLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x0d1320, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 60, 0x2a3a55, 0x18222f);
    grid.position.y = 0.001;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const actionBtn = actionBtnRef.current;

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();

      // Keep action button tracked above selected room
      if (actionBtn && moveModeRef.current === "pending") {
        const roomId = dragRoomIdRef.current;
        if (roomId && cameraRef.current && mountRef.current) {
          const mesh = meshMapRef.current.get(roomId);
          if (mesh) {
            const worldPos = new THREE.Vector3(
              mesh.position.x,
              mesh.position.y * 2 + 0.4,
              mesh.position.z,
            );
            worldPos.project(cameraRef.current);
            const rect = mountRef.current.getBoundingClientRect();
            actionBtn.style.left = `${((worldPos.x + 1) / 2) * rect.width}px`;
            actionBtn.style.top = `${((-worldPos.y + 1) / 2) * rect.height}px`;
            actionBtn.style.display = "flex";
          }
        } else {
          actionBtn.style.display = "none";
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!el || !rendererRef.current || !cameraRef.current) return;
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
      meshMapRef.current.clear();
      edgesMapRef.current.clear();
    };
  }, []);

  // Load the floor-plan source image used to crop each room's floor texture.
  // A fresh image invalidates the frozen layout bbox and all cached crops.
  useEffect(() => {
    const clearCrops = () => {
      roomCropMapRef.current.forEach((tex) => tex.dispose());
      roomCropMapRef.current.clear();
    };

    if (!floorPlanImageUrl) {
      floorImageRef.current = null;
      clearCrops();
      setImageVersion((v) => v + 1);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      floorImageRef.current = img;
      clearCrops();
      setImageVersion((v) => v + 1);
    };
    img.src = floorPlanImageUrl;

    return () => {
      cancelled = true;
    };
  }, [floorPlanImageUrl]);

  // Dispose all cached per-room crop textures on unmount
  useEffect(() => {
    return () => {
      roomCropMapRef.current.forEach((tex) => tex.dispose());
      roomCropMapRef.current.clear();
    };
  }, []);

  // Sync rooms to scene — avoids geometry rebuild when only position changed
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const stale = new Set(meshMapRef.current.keys());
    const draggingId = dragRoomIdRef.current;

    rooms.forEach((room, idx) => {
      stale.delete(room.id);
      const existing = meshMapRef.current.get(room.id);

      if (existing) {
        // Don't override position for the room being dragged (mesh is ahead of React state)
        if (room.id !== draggingId) {
          existing.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);
        }

        // Rebuild geometry only when dimensions actually changed
        const prev = roomDimsRef.current.get(room.id);
        const dimsChanged = !prev || prev.w !== room.w || prev.h !== room.h || prev.wh !== room.wallHeight;
        if (dimsChanged) {
          existing.geometry.dispose();
          existing.geometry = createOpenBoxGeo(room.w, room.wallHeight, room.h);
          const edgeSeg = edgesMapRef.current.get(room.id);
          if (edgeSeg) {
            edgeSeg.geometry.dispose();
            edgeSeg.geometry = new THREE.EdgesGeometry(existing.geometry);
          }
          roomDimsRef.current.set(room.id, { w: room.w, h: room.h, wh: room.wallHeight });
        }

        const mats = existing.material as THREE.MeshPhysicalMaterial[];

        // Crop this room's floor texture once (e.g. when the floor plan
        // image finishes loading after the mesh was already built). Once
        // set, the texture is fixed to the room — moving/resizing it never
        // triggers a re-crop, only a stretch via the geometry's 0-1 UVs.
        if (!roomCropMapRef.current.has(room.id) && floorImageRef.current && layoutBBoxRef.current) {
          const tex = createRoomFloorTexture(room, floorImageRef.current, layoutBBoxRef.current);
          roomCropMapRef.current.set(room.id, tex);
          mats[0].map = tex;
          mats[0].needsUpdate = true;
        }

        // Selection highlight on wall material
        const isSelected = room.id === selectedRoomId;
        mats[1].emissive.set(isSelected ? 0x442200 : 0x000000);
        mats[1].opacity = isSelected ? 0.35 : 0.15;
      } else {
        const { mesh, lineSegs } = buildRoom(room, idx);
        scene.add(mesh);
        meshMapRef.current.set(room.id, mesh);
        edgesMapRef.current.set(room.id, lineSegs);
      }
    });

    stale.forEach((id) => {
      const mesh = meshMapRef.current.get(id);
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material)
          ? (mesh.material as THREE.Material[])
          : [mesh.material as THREE.Material];
        mats.forEach((m) => m.dispose());
        meshMapRef.current.delete(id);
        edgesMapRef.current.delete(id);
        roomDimsRef.current.delete(id);
      }
      const cropTex = roomCropMapRef.current.get(id);
      if (cropTex) {
        cropTex.dispose();
        roomCropMapRef.current.delete(id);
      }
    });
  }, [rooms, selectedRoomId, buildRoom, imageVersion]);

  // ✓ button: enter active move mode
  const handleConfirm = useCallback(() => {
    moveModeRef.current = "active";
    if (actionBtnRef.current) actionBtnRef.current.style.display = "none";
  }, []);

  // ✗ button: cancel selection
  const handleCancel = useCallback(() => {
    moveModeRef.current = null;
    dragRoomIdRef.current = null;
    if (actionBtnRef.current) actionBtnRef.current.style.display = "none";
    onSelectRoomRef.current(null);
  }, []);

  // Mouse/touch event handlers
  useEffect(() => {
    if (readonly) return;
    const el = mountRef.current;
    if (!el) return;

    const onPointerDown = (clientX: number, clientY: number) => {
      pointerDownPosRef.current = { x: clientX, y: clientY };
      isDraggingRef.current = false;

      if (moveModeRef.current === "active") {
        // Ready to drag — disable orbit so camera doesn't move
        if (dragRoomIdRef.current && controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        return;
      }

      const pos = getCanvasPos(clientX, clientY);
      mouseRef.current.set(pos.x, pos.y);
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      const meshes = Array.from(meshMapRef.current.values());
      const hits = raycasterRef.current.intersectObjects(meshes, false);

      if (hits.length > 0) {
        let obj: THREE.Object3D = hits[0].object;
        while (obj && !obj.userData.roomId && obj.parent) obj = obj.parent;
        const roomId = obj.userData.roomId as string | undefined;
        if (roomId) {
          onSelectRoomRef.current(roomId);
          dragRoomIdRef.current = roomId;
          moveModeRef.current = "pending";
        }
      } else {
        onSelectRoomRef.current(null);
        dragRoomIdRef.current = null;
        moveModeRef.current = null;
        if (actionBtnRef.current) actionBtnRef.current.style.display = "none";
      }
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      if (moveModeRef.current !== "active" || !dragRoomIdRef.current) return;

      const dx = Math.abs(clientX - pointerDownPosRef.current.x);
      const dy = Math.abs(clientY - pointerDownPosRef.current.y);
      if (dx < 3 && dy < 3) return;

      isDraggingRef.current = true;

      const pos = getCanvasPos(clientX, clientY);
      mouseRef.current.set(pos.x, pos.y);
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      const target = new THREE.Vector3();
      if (!raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, target)) return;

      const room = roomsRef.current.find((r) => r.id === dragRoomIdRef.current);
      if (!room) return;

      // Snap to 0.5m grid
      const snappedX = Math.round(target.x / 0.5) * 0.5;
      const snappedZ = Math.round(target.z / 0.5) * 0.5;

      const mesh = meshMapRef.current.get(dragRoomIdRef.current!);
      if (mesh) mesh.position.set(snappedX, mesh.position.y, snappedZ);

      // Call onMoveRoom every move so React state stays in sync with visual position.
      // Geometry rebuild is suppressed by roomDimsRef (position-only change = no rebuild).
      onMoveRoomRef.current(
        dragRoomIdRef.current!,
        parseFloat((snappedX - room.w / 2).toFixed(1)),
        parseFloat((snappedZ - room.h / 2).toFixed(1)),
      );
    };

    const onPointerUp = () => {
      if (moveModeRef.current === "active") {
        moveModeRef.current = "pending";
      }
      isDraggingRef.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
    };

    const onMouseDown = (e: MouseEvent) => onPointerDown(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => onPointerMove(e.clientX, e.clientY);
    const onMouseUp = () => onPointerUp();

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => onPointerUp();

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [readonly]);

  return (
    <div ref={mountRef} className="w-full h-full" style={{ position: "relative" }}>
      {!readonly && (
        <div
          ref={actionBtnRef}
          style={{
            position: "absolute",
            display: "none",
            transform: "translate(-50%, -100%)",
            gap: "6px",
            pointerEvents: "auto",
            zIndex: 10,
          }}
        >
          <button
            onClick={handleConfirm}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: "#22c55e",
              color: "#fff",
              fontSize: 18,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✓
          </button>
          <button
            onClick={handleCancel}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: "#ef4444",
              color: "#fff",
              fontSize: 18,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✗
          </button>
        </div>
      )}
    </div>
  );
}
