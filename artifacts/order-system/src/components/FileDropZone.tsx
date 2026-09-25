import { useRef, useEffect, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  /** Pass true when the containing dialog is open so listeners activate */
  dialogOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function passesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  return accept.split(",").map(a => a.trim()).some(a => {
    if (a.startsWith(".")) return file.name.toLowerCase().endsWith(a.toLowerCase());
    if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -2));
    return file.type === a;
  });
}

/**
 * Drag-and-drop file zone that works inside Radix dialogs.
 *
 * Radix's DismissableLayer calls stopPropagation() on events in the bubble
 * phase, which silently blocks drop events from reaching window/document
 * bubble-phase listeners. We use { capture: true } so our handlers run
 * during the capture phase — before any element handler can stop propagation.
 */
export function FileDropZone({
  onFile,
  accept,
  disabled,
  dialogOpen = true,
  className,
  children,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Keep latest props in refs — effect only re-runs on dialogOpen change
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!dialogOpen) return;

    let dragCounter = 0;

    // capture: true — fires before Radix DismissableLayer's stopPropagation
    const onDragEnter = (e: DragEvent) => {
      // Accept any drag for visual feedback — email attachments may not report "Files"
      // in dataTransfer.types during the drag phase
      e.preventDefault();
      dragCounter++;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault(); // required on every dragover to allow drop
      setDragging(true);
    };

    const onDragLeave = (e: DragEvent) => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragging(false);
      if (disabledRef.current) return;
      // Try dataTransfer.files first, then items (email attachments may use items)
      let file: File | null = e.dataTransfer?.files?.[0] ?? null;
      if (!file && e.dataTransfer?.items) {
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind === "file") { file = item.getAsFile(); break; }
        }
      }
      if (file && passesAccept(file, acceptRef.current)) {
        onFileRef.current(file);
      }
    };

    // Use capture phase for ALL handlers — especially critical for "drop"
    const opts = { capture: true } as const;
    document.addEventListener("dragenter", onDragEnter, opts);
    document.addEventListener("dragover", onDragOver, opts);
    document.addEventListener("dragleave", onDragLeave, opts);
    document.addEventListener("drop", onDrop, opts);

    return () => {
      document.removeEventListener("dragenter", onDragEnter, opts);
      document.removeEventListener("dragover", onDragOver, opts);
      document.removeEventListener("dragleave", onDragLeave, opts);
      document.removeEventListener("drop", onDrop, opts);
      dragCounter = 0;
      setDragging(false);
    };
  }, [dialogOpen]);

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30",
        disabled ? "opacity-50 pointer-events-none" : "cursor-pointer",
        className,
      )}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f && passesAccept(f, acceptRef.current)) onFileRef.current(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Convenience inner content for the standard "upload" state */
export function FileDropZoneContent({
  uploading,
  label = "Drag from desktop or click to upload",
  hint,
}: {
  uploading?: boolean;
  label?: string;
  hint?: string;
}) {
  return uploading ? (
    <>
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-1" />
      <span className="text-xs text-muted-foreground">Uploading…</span>
    </>
  ) : (
    <>
      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
      <span className="text-xs text-muted-foreground">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</span>}
    </>
  );
}
