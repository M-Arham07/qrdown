"use client";

import { useEffect, useState } from "react";

export function ReceivedText({ blob, name }: { blob: Blob; name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let cancelled = false;
    void blob.text().then(value => { if (!cancelled) setText(value); }).catch(() => {
      if (!cancelled) setCopyStatus("Could not preview this text. Use the downloaded file.");
    });
    return () => { cancelled = true; };
  }, [blob]);
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4" aria-label="Received text">
      <p className="truncate text-sm font-medium text-zinc-950">{name}</p>
      {text !== null && <textarea readOnly value={text} aria-label="Received text content" rows={6}
        className="w-full resize-y rounded border border-zinc-200 p-3 text-sm text-zinc-950" />}
      <button type="button" disabled={text === null} onClick={async () => {
        try { await navigator.clipboard.writeText(text!); setCopyStatus("Copied"); }
        catch { setCopyStatus("Select the text above and copy it manually."); }
      }} className="btn-secondary min-h-11 rounded-lg px-4 text-sm disabled:opacity-50">Copy text</button>
      {copyStatus && <p role="status" className="text-xs text-zinc-600">{copyStatus}</p>}
    </section>
  );
}
