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
