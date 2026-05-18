"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Room } from "@/lib/types";

const ROOM_COLORS = [
  0x4a9eff, 0xff6b6b, 0x51cf66, 0xffd43b, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x74c0fc, 0xa9e34b,
];

const WALL_COLOR = 0xf5f0e8;  // cream white
const CEIL_COLOR = 0xfafafa;  // near white
const ROOF_COLOR = 0x7a6040;  // dark brown

// Build a gabled roof mesh covering all rooms. Defined outside component (no React deps).
function makeRoofMesh(rooms: Room[]): THREE.Mesh | null {
  if (rooms.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let maxH = 0;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);       maxX = Math.max(maxX, r.x + r.w);
    minZ = Math.min(minZ, r.y);       maxZ = Math.max(maxZ, r.y + r.h);
    maxH = Math.max(maxH, r.wallHeight);
  }

  const ov = 0.6;
  const x0 = minX - ov, x1 = maxX + ov;
  const z0 = minZ - ov, z1 = maxZ + ov;
  const spanX = x1 - x0, spanZ = z1 - z0;
  const rh = Math.min(spanX, spanZ) * 0.45;
  const base = maxH;

  const pos: number[] = [];
  const idx: number[] = [];

  if (spanX <= spanZ) {
    // Ridge runs along Z
    const cx = (x0 + x1) / 2;
    pos.push(
      x0, base, z0,        // 0 front-left eave
      x1, base, z0,        // 1 front-right eave
      x1, base, z1,        // 2 back-right eave
      x0, base, z1,        // 3 back-left eave
      cx, base + rh, z0,   // 4 front ridge
      cx, base + rh, z1,   // 5 back ridge
    );
    idx.push(
      0, 4, 5,  0, 5, 3,  // left slope
      1, 2, 5,  1, 5, 4,  // right slope
      0, 1, 4,            // front gable
      3, 5, 2,            // back gable
    );
  } else {
    // Ridge runs along X
    const cz = (z0 + z1) / 2;
    pos.push(
      x0, base, z0,        // 0 front-left eave
      x1, base, z0,        // 1 front-right eave
      x1, base, z1,        // 2 back-right eave
      x0, base, z1,        // 3 back-left eave
      x0, base + rh, cz,   // 4 left ridge
      x1, base + rh, cz,   // 5 right ridge
    );
    idx.push(
      0, 1, 5,  0, 5, 4,  // front slope
      3, 4, 5,  3, 5, 2,  // back slope
      0, 4, 3,            // left gable
      1, 2, 5,            // right gable
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ color: ROOF_COLOR, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
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
  const [sceneReady, setSceneReady] = useState(false);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const edgesMapRef = useRef<Map<string, THREE.LineSegments>>(new Map());
  const roofMeshRef = useRef<THREE.Mesh | null>(null);
  const animFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const dragRoomIdRef = useRef<string | null>(null);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const pointerDownPosRef = useRef({ x: 0, y: 0 });

  // Keep refs current so drag effect doesn't need rooms/callbacks in deps
  const roomsRef = useRef<Room[]>(rooms);
  const onSelectRoomRef = useRef(onSelectRoom);
  const onMoveRoomRef = useRef(onMoveRoom);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { onSelectRoomRef.current = onSelectRoom; }, [onSelectRoom]);
  useEffect(() => { onMoveRoomRef.current = onMoveRoom; }, [onMoveRoom]);

  const getCanvasPos = (clientX: number, clientY: number) => {
    const rect = mountRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  // BoxGeometry face groups: +X(0), -X(1), +Y/ceil(2), -Y/floor(3), +Z(4), -Z(5)
  const buildRoom = useCallback((room: Room, colorIdx: number) => {
    const geo = new THREE.BoxGeometry(room.w, room.wallHeight, room.h);
    const wallMat = () => new THREE.MeshLambertMaterial({ color: WALL_COLOR });
    const ceilMat = new THREE.MeshLambertMaterial({ color: CEIL_COLOR });
    const floorMat = new THREE.MeshLambertMaterial({ color: ROOM_COLORS[colorIdx % ROOM_COLORS.length] });
    const materials = [wallMat(), wallMat(), ceilMat, floorMat, wallMat(), wallMat()];

    const mesh = new THREE.Mesh(geo, materials);
    mesh.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);
    mesh.userData.roomId = room.id;
    mesh.userData.colorIdx = colorIdx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edges = new THREE.EdgesGeometry(geo);
    const lineSegs = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xaaaaaa })
    );
    mesh.add(lineSegs);

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

    // Ambient: soft sky light
    scene.add(new THREE.AmbientLight(0xc8d8e8, 0.7));

    // Hemisphere light for sky/ground gradient
    scene.add(new THREE.HemisphereLight(0xddeeff, 0xc8b89a, 0.4));

    // Main sun light with realistic shadows
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

    // Ground plane that receives shadows
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshLambertMaterial({ color: 0xc8c0a8 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Subtle grid on top of ground
    const grid = new THREE.GridHelper(60, 60, 0xb0a890, 0xb8b0a0);
    grid.position.y = 0.001;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    setSceneReady(true);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
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
      roofMeshRef.current = null;
      setSceneReady(false);
    };
  }, []);

  // Sync rooms to scene + rebuild roof
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const stale = new Set(meshMapRef.current.keys());

    rooms.forEach((room, idx) => {
      stale.delete(room.id);
      const existing = meshMapRef.current.get(room.id);

      if (existing) {
        // Update position
        existing.position.set(room.x + room.w / 2, room.wallHeight / 2, room.y + room.h / 2);

        // Rebuild geometry for dimension changes
        existing.geometry.dispose();
        existing.geometry = new THREE.BoxGeometry(room.w, room.wallHeight, room.h);

        // Rebuild edge geometry
        const edgeSeg = edgesMapRef.current.get(room.id);
        if (edgeSeg) {
          edgeSeg.geometry.dispose();
          edgeSeg.geometry = new THREE.EdgesGeometry(existing.geometry);
        }

        // Selection highlight on wall materials (indices 0,1,4,5)
        const mats = existing.material as THREE.MeshLambertMaterial[];
        const isSelected = room.id === selectedRoomId;
        for (const i of [0, 1, 4, 5]) {
          mats[i].emissive.set(isSelected ? 0x221100 : 0x000000);
        }
      } else {
        const { mesh, lineSegs } = buildRoom(room, idx);
        scene.add(mesh);
        meshMapRef.current.set(room.id, mesh);
        edgesMapRef.current.set(room.id, lineSegs);
      }
    });

    // Remove deleted rooms
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
      }
    });

    // Rebuild roof whenever rooms change
    if (roofMeshRef.current) {
      scene.remove(roofMeshRef.current);
      roofMeshRef.current.geometry.dispose();
      (roofMeshRef.current.material as THREE.Material).dispose();
      roofMeshRef.current = null;
    }
    const roof = makeRoofMesh(rooms);
    if (roof) {
      scene.add(roof);
      roofMeshRef.current = roof;
    }
  }, [rooms, selectedRoomId, buildRoom, sceneReady]);

  // Mouse/touch event handlers — registered once, use refs for live data
  useEffect(() => {
    if (readonly) return;
    const el = mountRef.current;
    if (!el) return;

    const onPointerDown = (clientX: number, clientY: number) => {
      pointerDownPosRef.current = { x: clientX, y: clientY };
      isDraggingRef.current = false;

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
          if (controlsRef.current) controlsRef.current.enabled = false;
        }
      } else {
        onSelectRoomRef.current(null);
        dragRoomIdRef.current = null;
      }
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      if (!dragRoomIdRef.current) return;

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

      const mesh = meshMapRef.current.get(dragRoomIdRef.current!);
      if (mesh) {
        mesh.position.set(target.x, mesh.position.y, target.z);
      }

      onMoveRoomRef.current(
        dragRoomIdRef.current!,
        parseFloat((target.x - room.w / 2).toFixed(1)),
        parseFloat((target.z - room.h / 2).toFixed(1))
      );
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      dragRoomIdRef.current = null;
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

  return <div ref={mountRef} className="w-full h-full" />;
}
