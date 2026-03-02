import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";

interface CompressResult {
  original_size: number;
  compressed_size: number;
  temp_path: string;
  savings_percent: number;
}

type ItemStatus = "pending" | "compressing" | "done" | "error";

interface ImageItem {
  id: string;
  path: string;
  name: string;
  format: string;
  originalSize: number;
  compressedSize?: number;
  tempPath?: string;
  savingsPercent?: number;
  status: ItemStatus;
  errorMsg?: string;
  thumbUrl: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [quality, setQuality] = useState(80);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback((paths: string[]) => {
    const supported = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png");
    });

    const newItems: ImageItem[] = supported.map((p) => {
      const name = p.split("/").pop() ?? p;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const format = ext === "jpg" || ext === "jpeg" ? "JPEG" : "PNG";
      return {
        id: generateId(),
        path: p,
        name,
        format,
        originalSize: 0,
        status: "pending",
        thumbUrl: convertFileSrc(p),
      };
    });

    if (newItems.length === 0) return;

    // Get file sizes via Rust
    setItems((prev) => {
      const ids = new Set(prev.map((i) => i.path));
      const fresh = newItems.filter((i) => !ids.has(i.path));
      return [...prev, ...fresh];
    });

    // Fetch file sizes
    newItems.forEach((item) => {
      invoke<number>("get_file_size", { path: item.path })
        .then((size) => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, originalSize: size } : i))
          );
        })
        .catch(() => {});
    });
  }, []);

  // Set up Tauri drag-drop listener
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragging(true);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          const paths = event.payload.paths ?? [];
          addFiles(paths);
        } else {
          setIsDragging(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [addFiles]);

  const compressItem = useCallback(
    async (item: ImageItem) => {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "compressing" } : i))
      );
      try {
        const result = await invoke<CompressResult>("compress_image", {
          inputPath: item.path,
          quality,
        });
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "done",
                  compressedSize: result.compressed_size,
                  tempPath: result.temp_path,
                  savingsPercent: result.savings_percent,
                  originalSize: result.original_size,
                }
              : i
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", errorMsg: String(err) }
              : i
          )
        );
      }
    },
    [quality]
  );

  const compressAll = useCallback(async () => {
    const pending = items.filter((i) => i.status === "pending" || i.status === "error");
    await Promise.all(pending.map((i) => compressItem(i)));
  }, [items, compressItem]);

  const saveItem = useCallback(async (item: ImageItem) => {
    if (!item.tempPath) return;
    const ext = item.format === "JPEG" ? "jpg" : "png";
    const defaultName = item.name.replace(/\.[^.]+$/, `_compressed.${ext}`);
    const outputPath = await save({
      defaultPath: defaultName,
      filters: [{ name: item.format, extensions: [ext] }],
    });
    if (!outputPath) return;
    await invoke("save_image", { tempPath: item.tempPath, outputPath });
  }, []);

  const saveAll = useCallback(async () => {
    const done = items.filter((i) => i.status === "done" && i.tempPath);
    if (done.length === 0) return;

    const outputDir = await open({
      directory: true,
      title: "Select output folder",
    });
    if (!outputDir || Array.isArray(outputDir)) return;

    const saveItems = done.map((i) => ({
      temp_path: i.tempPath!,
      name: i.name,
      format: i.format,
    }));
    await invoke("save_all_images", { items: saveItems, outputDir });
  }, [items]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  // Stats
  const doneItems = items.filter((i) => i.status === "done");
  const totalOriginal = doneItems.reduce((s, i) => s + i.originalSize, 0);
  const totalCompressed = doneItems.reduce((s, i) => s + (i.compressedSize ?? 0), 0);
  const totalSaved = totalOriginal - totalCompressed;

  const hasPendingOrError = items.some((i) => i.status === "pending" || i.status === "error");
  const hasDone = doneItems.length > 0;

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">Image Compressor</span>
        <div className="header-controls">
          <div className="quality-control">
            <span>JPEG Quality:</span>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="quality-slider"
            />
            <span className="quality-value">{quality}%</span>
          </div>
          <button
            className="btn btn-primary"
            onClick={compressAll}
            disabled={!hasPendingOrError || items.length === 0}
          >
            Compress All
          </button>
          <button
            className="btn btn-secondary"
            onClick={saveAll}
            disabled={!hasDone}
          >
            Save All
          </button>
          <button
            className="btn btn-ghost"
            onClick={clearAll}
            disabled={items.length === 0}
          >
            Clear
          </button>
        </div>
      </header>

      <div className="drop-zone">
        {isDragging && (
          <div className="drop-overlay">
            <div className="drop-overlay-icon">📂</div>
            <div className="drop-overlay-text">Drop images here</div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🖼️</div>
            <div className="empty-state-title">Drop images here</div>
            <div className="empty-state-subtitle">Supports JPG and PNG files</div>
          </div>
        ) : (
          <div className="image-list">
            {items.map((item) => (
              <div key={item.id} className="image-card">
                <img
                  src={item.thumbUrl}
                  alt={item.name}
                  className="image-thumb"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="image-info">
                  <div className="image-name">{item.name}</div>
                  <div className="image-meta">
                    <span className="format-badge">{item.format}</span>
                    {item.originalSize > 0 && (
                      <span>{formatBytes(item.originalSize)}</span>
                    )}
                  </div>
                </div>

                <div className="size-info">
                  {item.status === "done" && item.compressedSize !== undefined && (
                    <>
                      <span className="size-original">
                        {formatBytes(item.originalSize)}
                      </span>
                      <span className="size-arrow">→</span>
                      <span className="size-compressed">
                        {formatBytes(item.compressedSize)}
                      </span>
                      <span className="size-savings">
                        -{item.savingsPercent?.toFixed(1)}%
                      </span>
                    </>
                  )}
                </div>

                <div className="card-actions">
                  {item.status === "pending" && (
                    <>
                      <span className="status-pending">Pending</span>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: "12px", padding: "5px 12px" }}
                        onClick={() => compressItem(item)}
                      >
                        Compress
                      </button>
                    </>
                  )}
                  {item.status === "compressing" && (
                    <span className="status-compressing">Compressing...</span>
                  )}
                  {item.status === "done" && (
                    <>
                      <span className="status-done">Done</span>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: "12px", padding: "5px 12px" }}
                        onClick={() => saveItem(item)}
                      >
                        Save
                      </button>
                    </>
                  )}
                  {item.status === "error" && (
                    <>
                      <span className="status-error" title={item.errorMsg}>
                        Error
                      </span>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: "12px", padding: "5px 12px" }}
                        onClick={() => compressItem(item)}
                      >
                        Retry
                      </button>
                    </>
                  )}
                  <button
                    className="btn-remove"
                    onClick={() => removeItem(item.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stats-bar">
        <div className="stat">
          <span>Files:</span>
          <span className="stat-value">{items.length}</span>
        </div>
        <div className="stat">
          <span>Compressed:</span>
          <span className="stat-value">{doneItems.length}</span>
        </div>
        {totalSaved > 0 && (
          <div className="stat">
            <span>Total saved:</span>
            <span className="stat-value">{formatBytes(totalSaved)}</span>
          </div>
        )}
        {totalOriginal > 0 && (
          <div className="stat">
            <span>Reduction:</span>
            <span className="stat-value">
              {((totalSaved / totalOriginal) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
