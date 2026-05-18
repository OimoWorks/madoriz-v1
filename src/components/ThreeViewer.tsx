"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Room } from "@/lib/types";

const ROOM_COLORS = [
  0x4a9eff, 0xff6b6b, 0x51cf66, 0xffd43b, 0xcc5de8,
  0xff922b, 0x20c997, 0xf06595, 0x74c0fc, 0xa9e34b,
];

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

  const getCanvasPos = (clientX: number, clientY: number) => {
    const rect = mountRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  const buildRoom = useCallback(
    (room: Room, colorIdx: number) => {
      const geometry = new THREE.BoxGeometry(room.w, room.wallHeight, room.h);
      const color = ROOM_COLORS[colorIdx % ROOM_COLORS.length];
      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        room.x + room.w / 2,
        room.wallHeight / 2,
        room.y + room.h / 2
      );
      mesh.userData.roomId = room.id;
      mesh.userData.colorIdx = colorIdx;

      const edges = new THREE.EdgesGeometry(geometry);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
      const lineSegs = new THREE.LineSegments(edges, lineMat);
      mesh.add(lineSegs);

      return { mesh, lineSegs };
    },
    []
  );

  // Initial scene setup
  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 1000);
    camera.position.set(10, 12, 15);
    camera.lookAt(5, 0, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Grid floor
    const gridHelper = new THREE.GridHelper(40, 40, 0xcccccc, 0xdddddd);
    scene.add(gridHelper);

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

  // Sync rooms to scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = new Set(meshMapRef.current.keys());

    rooms.forEach((room, idx) => {
      existing.delete(room.id);
      const existing_mesh = meshMapRef.current.get(room.id);

      if (existing_mesh) {
        // Update position and geometry
        existing_mesh.position.set(
          room.x + room.w / 2,
          room.wallHeight / 2,
          room.y + room.h / 2
        );
        existing_mesh.geometry.dispose();
        existing_mesh.geometry = new THREE.BoxGeometry(room.w, room.wallHeight, room.h);

        // Update edges
        const edgeSeg = edgesMapRef.current.get(room.id);
        if (edgeSeg) {
          edgeSeg.geometry.dispose();
          edgeSeg.geometry = new THREE.EdgesGeometry(existing_mesh.geometry);
        }

        // Highlight selected
        const mat = existing_mesh.material as THREE.MeshLambertMaterial;
        if (room.id === selectedRoomId) {
          mat.emissive.set(0x888800);
          mat.opacity = 1;
        } else {
          mat.emissive.set(0x000000);
          mat.opacity = 0.85;
        }
      } else {
        const { mesh, lineSegs } = buildRoom(room, idx);
        scene.add(mesh);
        meshMapRef.current.set(room.id, mesh);
        edgesMapRef.current.set(room.id, lineSegs);
      }
    });

    // Remove deleted rooms
    existing.forEach((id) => {
      const mesh = meshMapRef.current.get(id);
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        meshMapRef.current.delete(id);
        edgesMapRef.current.delete(id);
      }
    });
  }, [rooms, selectedRoomId, buildRoom, sceneReady]);

  // Mouse/touch event handlers for drag
  useEffect(() => {
    if (readonly) return;
    const el = mountRef.current;
    if (!el) return;

    const onPointerDown = (clientX: number, clientY: number) => {
      pointerDownPosRef.current = { x: clientX, y: clientY };
      const pos = getCanvasPos(clientX, clientY);
      mouseRef.current.set(pos.x, pos.y);

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);
      const meshes = Array.from(meshMapRef.current.values());
      const hits = raycasterRef.current.intersectObjects(meshes);

      if (hits.length > 0) {
        const roomId = hits[0].object.userData.roomId as string;
        onSelectRoom(roomId);
        isDraggingRef.current = false;
        dragRoomIdRef.current = roomId;
      } else {
        onSelectRoom(null);
        dragRoomIdRef.current = null;
      }
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      if (!dragRoomIdRef.current) return;

      const dx = Math.abs(clientX - pointerDownPosRef.current.x);
      const dy = Math.abs(clientY - pointerDownPosRef.current.y);
      if (!isDraggingRef.current && dx < 5 && dy < 5) return;

      isDraggingRef.current = true;
      if (controlsRef.current) controlsRef.current.enabled = false;

      const pos = getCanvasPos(clientX, clientY);
      mouseRef.current.set(pos.x, pos.y);
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);

      const target = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, target);

      const room = rooms.find((r) => r.id === dragRoomIdRef.current);
      if (!room) return;

      const mesh = meshMapRef.current.get(dragRoomIdRef.current!);
      if (mesh) {
        mesh.position.set(target.x, mesh.position.y, target.z);
      }

      onMoveRoom(
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
      if (e.touches.length === 1)
        onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1)
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => onPointerUp();

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [readonly, rooms, onSelectRoom, onMoveRoom]);

  return <div ref={mountRef} className="w-full h-full" />;
}
