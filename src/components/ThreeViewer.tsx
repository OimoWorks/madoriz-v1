"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Room } from "@/lib/types";

const ROOM_COLORS = [
  0x4a9eff, 0xff6b6b, 0x51cf66, 0xffd43b, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x74c0fc, 0xa9e34b,
];

// Open-top box: floor (group 0) + 4 walls (group 1), with UV coords for texture
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
    uvs.push(0, 0,  1, 0,  1, 1,  0, 1);
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

// Pick white or black text based on perceived luminance of the background color
function pickTextColor(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#000000" : "#ffffff";
}

function createFloorTexture(name: string, colorHex: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = `#${colorHex.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = pickTextColor(colorHex);
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, size / 2, size / 2);

  return new THREE.CanvasTexture(canvas);
}

interface ThreeViewerProps {
  rooms: Room[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onMoveRoom: (id: string, x: number, y: number) => void;
  readonly?: boolean;
}

export default function ThreeViewer({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onMoveRoom,
  readonly = false,
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
  // Final position to commit on pointer-up (avoids mid-drag React re-renders)
  const pendingMoveRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const pointerDownPosRef = useRef({ x: 0, y: 0 });

  // Cached room metadata — skip geometry/texture rebuild when unchanged
  const roomDimsRef = useRef<Map<string, { w: number; h: number; wh: number }>>(new Map());
  const roomNamesRef = useRef<Map<string, string>>(new Map());

  const roomsRef = useRef<Room[]>(rooms);
  const onSelectRoomRef = useRef(onSelectRoom);
  const onMoveRoomRef = useRef(onMoveRoom);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { onSelectRoomRef.current = onSelectRoom; }, [onSelectRoom]);
  useEffect(() => { onMoveRoomRef.current = onMoveRoom; }, [onMoveRoom]);

  // Reset move mode when selection is cleared externally
  useEffect(() => {
    if (!selectedRoomId) {
      moveModeRef.current = null;
      dragRoomIdRef.current = null;
      pendingMoveRef.current = null;
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

  const buildRoom = useCallback((room: Room, colorIdx: number) => {
    const geo = createOpenBoxGeo(room.w, room.wallHeight, room.h);

    const floorMat = new THREE.MeshStandardMaterial({
      map: createFloorTexture(room.name, ROOM_COLORS[colorIdx % ROOM_COLORS.length]),
      roughness: 0.7,
      metalness: 0,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, [floorMat, wallMat]);
    mesh.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);
    mesh.userData.roomId = room.id;
    mesh.userData.colorIdx = colorIdx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edges = new THREE.EdgesGeometry(geo);
    const lineSegs = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xaaaaaa }),
    );
    mesh.add(lineSegs);

    roomDimsRef.current.set(room.id, { w: room.w, h: room.h, wh: room.wallHeight });
    roomNamesRef.current.set(room.id, room.name);

    return { mesh, lineSegs };
  }, []);

  // Initial scene setup
  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdde8f0);
    scene.fog = new THREE.Fog(0xdde8f0, 60, 120);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 1000);
    camera.position.set(10, 12, 15);
    camera.lookAt(5, 0, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xc8d8e8, 0.7));
    scene.add(new THREE.HemisphereLight(0xddeeff, 0xc8b89a, 0.4));

    const dirLight = new THREE.DirectionalLight(0xfffaf0, 1.1);
    dirLight.position.set(15, 28, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshLambertMaterial({ color: 0xc8c0a8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 60, 0xb0a890, 0xb8b0a0);
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

        // Rebuild floor texture when name or dims changed
        const nameChanged = roomNamesRef.current.get(room.id) !== room.name;
        if (nameChanged || dimsChanged) {
          const mats = existing.material as THREE.MeshStandardMaterial[];
          if (mats[0].map) mats[0].map.dispose();
          mats[0].map = createFloorTexture(room.name, ROOM_COLORS[existing.userData.colorIdx % ROOM_COLORS.length]);
          mats[0].needsUpdate = true;
          roomNamesRef.current.set(room.id, room.name);
        }

        // Selection highlight on wall material
        const mats = existing.material as THREE.MeshStandardMaterial[];
        mats[1].emissive.set(room.id === selectedRoomId ? 0x221100 : 0x000000);
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
        mats.forEach((m) => {
          const sm = m as THREE.MeshStandardMaterial;
          if (sm.map) sm.map.dispose();
          m.dispose();
        });
        meshMapRef.current.delete(id);
        edgesMapRef.current.delete(id);
        roomDimsRef.current.delete(id);
        roomNamesRef.current.delete(id);
      }
    });
  }, [rooms, selectedRoomId, buildRoom]);

  // ✓ button: enter active move mode
  const handleConfirm = useCallback(() => {
    moveModeRef.current = "active";
    if (actionBtnRef.current) actionBtnRef.current.style.display = "none";
  }, []);

  // ✗ button: cancel selection
  const handleCancel = useCallback(() => {
    moveModeRef.current = null;
    dragRoomIdRef.current = null;
    pendingMoveRef.current = null;
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
        pendingMoveRef.current = null;
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

      // Update mesh position visually — no React state update yet (prevents jitter)
      const mesh = meshMapRef.current.get(dragRoomIdRef.current!);
      if (mesh) mesh.position.set(snappedX, mesh.position.y, snappedZ);

      // Store final position to commit on pointer-up
      pendingMoveRef.current = {
        id: dragRoomIdRef.current!,
        x: parseFloat((snappedX - room.w / 2).toFixed(1)),
        y: parseFloat((snappedZ - room.h / 2).toFixed(1)),
      };
    };

    const onPointerUp = () => {
      // Commit drag position to React state exactly once per drag
      if (pendingMoveRef.current && isDraggingRef.current) {
        const { id, x, y } = pendingMoveRef.current;
        onMoveRoomRef.current(id, x, y);
        pendingMoveRef.current = null;
      }
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
