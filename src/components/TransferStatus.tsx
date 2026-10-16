"use client";

interface TransferStatusProps {
  status: "COMPLETED" | "CANCELLED" | "ERROR";
  errorMessage?: string | null;
  onReset: () => void;
}

export function TransferStatus({ status, errorMessage, onReset }: TransferStatusProps) {
  return (
    <div className="flex flex-col items-start gap-5 py-4" role="status">
      <div>
        <h2 className="text-xl font-semibold">
          {status === "COMPLETED" ? "Transfer complete" : status === "CANCELLED" ? "Transfer cancelled" : "Transfer interrupted"}
        </h2>
        {status === "ERROR" && <p className="mt-2 text-sm text-[#52525B]">{errorMessage || "Reconnect the devices and try again."}</p>}
      </div>
      <button onClick={onReset} className="btn-primary rounded-lg px-5 py-3 text-sm font-medium">
        {status === "COMPLETED" ? "New transfer" : "Start again"}
      </button>
    </div>
  );
}
