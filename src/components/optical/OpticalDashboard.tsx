"use client";

import { useState } from "react";
import { OpticalSender } from "./OpticalSender";
import { OpticalReceiver } from "./OpticalReceiver";

export function OpticalDashboard() {
  const [direction, setDirection] = useState<"send" | "receive">("send");
  return (
    <section className="warm-card p-5 sm:p-7" aria-label="QR transfer">
      <div className="mb-6 flex gap-1 border-b border-zinc-200" aria-label="Transfer direction">
        {(["send", "receive"] as const).map(value => (
          <button key={value} type="button" aria-pressed={direction === value}
            onClick={() => setDirection(value)}
            className={`min-h-11 border-b-2 px-5 text-sm font-medium transition-colors ${direction === value ? "border-blue-700 text-zinc-950" : "border-transparent text-zinc-600 hover:text-zinc-950"}`}>
            {value === "send" ? "Send" : "Receive"}
          </button>
        ))}
      </div>
      {direction === "send" ? <OpticalSender /> : <OpticalReceiver />}
    </section>
  );
}
