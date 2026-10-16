"use client";

import { useState, useRef } from "react";
import { useTransferStore } from "@/stores/useTransferStore";
import { TransferComposer } from "@/components/TransferComposer";
import { Upload, File as FileIcon, X, ArrowRight } from "lucide-react";

interface FilePickerProps {
  onStartSharing: () => void;
}

export function FilePicker({ onStartSharing }: FilePickerProps) {
  const { selectedFiles, addFiles, removeFile } = useTransferStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);
    addFiles(filesArray);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="w-full flex flex-col gap-5">
      {/* Drag & Drop Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        aria-label="Choose files to send"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        className={`w-full border-2 border-dashed rounded-lg p-8 sm:p-12 text-center cursor-pointer transition-colors duration-200 flex flex-col items-center justify-center gap-3 ${
          isDragOver
            ? "border-[#1D4ED8] bg-[#EFF6FF]"
            : "border-[#D4D4D8] bg-[#FAFAFA] hover:border-[#1D4ED8] hover:bg-[#FAFAFA]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Files to send"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="w-14 h-14 rounded-lg bg-[#EFF6FF] text-[#1D4ED8] flex items-center justify-center ">
          <Upload className="w-7 h-7" />
        </div>
        <div>
          <p className="font-semibold text-base text-[#18181B]">
            Drop files here or <span className="text-[#1D4ED8] underline underline-offset-2">browse</span>
          </p>
          <p className="text-xs text-[#71717A] mt-1">
            Choose one or more files
          </p>
        </div>
      </div>

      <TransferComposer onAdd={addFiles} />

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-medium text-[#52525B] px-1">
            <span>
              {selectedFiles.length} {selectedFiles.length === 1 ? "file" : "files"} selected
            </span>
            <span>Total: {formatSize(totalBytes)}</span>
          </div>

          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between p-3 rounded-lg bg-white border border-[#E4E4E7]  hover:border-[#D4D4D8] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-[#F4F4F5] text-[#52525B] flex items-center justify-center shrink-0">
                    <FileIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#18181B] truncate">{file.name}</p>
                    <p className="text-xs text-[#71717A]">{formatSize(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                  className="p-1 rounded-lg text-[#71717A] hover:text-[#C23E2A] hover:bg-[#FDEEEB] transition-colors"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Action button */}
          <button
            onClick={onStartSharing}
            className="w-full py-3.5 px-6 rounded-lg btn-primary font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer mt-1"
          >
            <span>Get connection code</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
