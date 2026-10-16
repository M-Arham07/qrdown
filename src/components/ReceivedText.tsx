"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { fileTransferService } from "@/services/fileTransfer";
import { TEXT_MAX_BYTES } from "@/services/textTransfer";

export function ReceivedText({ blob, name }: { blob: Blob; name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let cancelled = false;
    void blob.slice(0, TEXT_MAX_BYTES).text().then(value => { if (!cancelled) setText(value); }).catch(() => {
      if (!cancelled) setCopyStatus("Could not preview this text. Use Download to save the file.");
    });
    return () => { cancelled = true; };
  }, [blob]);
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4" aria-label="Received text">
      <p className="truncate text-sm font-medium text-zinc-950">{name}</p>
      {text !== null && <textarea readOnly value={text} aria-label="Received text content" rows={6}
        className="w-full resize-y rounded border border-zinc-200 p-3 text-sm text-zinc-950" />}
      {blob.size > TEXT_MAX_BYTES && <p className="text-xs text-zinc-600">Showing the first 1 MB. Copy and Download include the full text.</p>}
      <div className="flex items-center gap-2">
      <button type="button" disabled={text === null} onClick={async () => {
        try { await navigator.clipboard.writeText(blob.size > TEXT_MAX_BYTES ? await blob.text() : text!); setCopyStatus("Copied"); }
        catch { setCopyStatus("Select the text above and copy it manually."); }
      }} className="btn-secondary min-h-11 rounded-lg px-4 text-sm disabled:opacity-50">Copy text</button>
      <button type="button" onClick={() => fileTransferService.downloadBlob(blob, name)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-100" aria-label="Download text file">
        <Download className="h-3.5 w-3.5" aria-hidden="true" />Download
      </button>
      </div>
      {copyStatus && <p role="status" className="text-xs text-zinc-600">{copyStatus}</p>}
    </section>
  );
}
