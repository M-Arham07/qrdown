"use client";

interface CloudFallbackPromptProps {
  onAccept: () => void;
  onCancel: () => void;
  isSender: boolean;
}

export function CloudFallbackPrompt({ onAccept, onCancel, isSender }: CloudFallbackPromptProps) {
  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h2 className="text-xl font-semibold">Couldn’t connect the devices</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#52525B]">
          {isSender ? "You can send the first selected file through temporary cloud storage instead. The limit is 100 MB." : "Waiting for the sender to choose another way to send the file. Keep this page open."}
        </p>
      </div>
      {isSender && <p className="text-sm leading-relaxed text-[#52525B]">The file is encrypted before upload. Its key is shared through WebSend’s server.</p>}
      <div className="flex flex-wrap gap-3">
        {isSender && <button onClick={onAccept} className="btn-primary rounded-lg px-5 py-3 text-sm font-medium">Send through cloud</button>}
        <button onClick={onCancel} className="btn-secondary rounded-lg px-5 py-3 text-sm font-medium">Cancel</button>
      </div>
    </div>
  );
}
