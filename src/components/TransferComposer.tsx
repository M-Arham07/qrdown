"use client";

import { useEffect, useRef, useState } from "react";
import { createTextFile, TEXT_MAX_BYTES } from "@/services/textTransfer";

interface TransferComposerProps {
  onAdd: (files: File[]) => void;
  maxBytes?: number;
  actionLabel?: string;
}

export function TransferComposer({ onAdd, maxBytes, actionLabel = "Add to transfer" }: TransferComposerProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    if (imageRef.current) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      const editing = target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])"));
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) {
        for (const item of Array.from(event.clipboardData?.items ?? [])) {
          const file = item.kind === "file" ? item.getAsFile() : null;
          if (file) files.push(file);
        }
      }
      const pastedImage = files.find(file => file.type.startsWith("image/"));
      if (pastedImage) {
        // Preserve normal paste into unrelated editable controls.
        if (editing && !(target instanceof Element && target.closest("[data-transfer-composer]"))) return;
        event.preventDefault();
        setImage(pastedImage);
        setText("");
        return;
      }
      if (editing) return;
      const pastedText = event.clipboardData?.getData("text/plain");
      if (pastedText) {
        event.preventDefault();
        setText(pastedText);
        setImage(null);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  const bytes = image?.size ?? new Blob([text]).size;
  const limit = image ? maxBytes : Math.min(maxBytes ?? TEXT_MAX_BYTES, TEXT_MAX_BYTES);
  const oversized = limit !== undefined && bytes > limit;
  const hasContent = Boolean(image || text.length);
  return (
    <section data-transfer-composer className="space-y-3" aria-label="Text and clipboard transfer">
      <label className="block text-sm font-medium text-zinc-950" htmlFor="transfer-text">Send text or paste an image</label>
      {image ? (
        <div className="rounded-lg border border-zinc-200 p-3">
          {/* Clipboard object URLs stay local and are revoked when replaced. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} alt="Pasted image ready to transfer" className="mx-auto max-h-48 max-w-full rounded object-contain" />
          <p className="mt-2 truncate text-xs text-zinc-600">{image.name} · {(bytes / 1000).toFixed(1)} KB</p>
        </div>
      ) : (
        <textarea id="transfer-text" value={text} onChange={event => setText(event.target.value)} rows={4}
          placeholder="Type text here, or paste text or an image anywhere on this screen."
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-950 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20" />
      )}
      {oversized && <p role="alert" className="text-sm text-red-700">This content exceeds the {limit! / 1_000_000} MB limit.{maxBytes ? " Use network transfer for larger files." : " Choose a file instead."}</p>}
      {hasContent && <div className="flex items-center gap-3">
        <button type="button" disabled={oversized} onClick={() => {
          if (oversized) return;
          onAdd([image ?? createTextFile(text)]);
          setText(""); setImage(null);
        }} className="btn-secondary min-h-11 rounded-lg px-4 text-sm disabled:opacity-50">{actionLabel}</button>
        <button type="button" onClick={() => { setText(""); setImage(null); }} className="min-h-11 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100">Clear</button>
        {!image && <span className="ml-auto text-xs tabular-nums text-zinc-600">{(bytes / 1000).toFixed(1)} KB</span>}
      </div>}
    </section>
  );
}
