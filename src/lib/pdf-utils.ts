// Client-side only: renders PDF page 1 to PNG base64 using pdfjs-dist
export async function renderPdfPageToBase64(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  // Use unpkg CDN for the worker to avoid webpack bundling issues
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  pdf.destroy();
  return canvas.toDataURL("image/png").split(",")[1];
}
