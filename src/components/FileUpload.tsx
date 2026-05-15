"use client";

import { useRef, useState } from "react";

interface FileUploadProps {
  onFile: (file: File) => void;
  loading: boolean;
}

export default function FileUpload({ onFile, loading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "image/png" || file.type === "image/jpeg")) {
      onFile(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
        dragging
          ? "border-blue-500 bg-blue-50"
          : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={handleChange}
      />
      <div className="text-4xl mb-3">🏠</div>
      {loading ? (
        <p className="text-blue-600 font-medium animate-pulse">AI解析中...</p>
      ) : (
        <>
          <p className="text-gray-700 font-medium mb-1">
            間取り図をドラッグ&ドロップ
          </p>
          <p className="text-sm text-gray-400">または クリックして選択（PNG / JPG）</p>
        </>
      )}
    </div>
  );
}
