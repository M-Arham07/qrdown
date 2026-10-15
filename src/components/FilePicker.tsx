"use client";

import { useState, useRef } from "react";
import { useTransferStore } from "@/stores/useTransferStore";
import { UploadCloud, File as FileIcon, X, ArrowRight } from "lucide-react";

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
        onClick={() => inputRef.current?.click()}
        className={`w-full border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-3 ${
          isDragOver
            ? "border-[#C45F2C] bg-[#FFF7F2] scale-[0.99]"
            : "border-[#DFD0BE] bg-[#FDFBF7] hover:border-[#C45F2C] hover:bg-[#FAF6EF]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="w-14 h-14 rounded-2xl bg-[#FBECE3] text-[#C45F2C] flex items-center justify-center shadow-sm">
          <UploadCloud className="w-7 h-7" />
        </div>
        <div>
          <p className="font-semibold text-base text-[#2C1A11]">
            Drop files here or <span className="text-[#C45F2C] underline underline-offset-2">browse</span>
          </p>
          <p className="text-xs text-[#9C8373] mt-1">
            Send photos, videos, archives, documents — up to 2 GB
          </p>
        </div>
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-medium text-[#6B5244] px-1">
            <span>
              {selectedFiles.length} {selectedFiles.length === 1 ? "file" : "files"} selected
            </span>
            <span>Total: {formatSize(totalBytes)}</span>
          </div>

          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#EDE2D3] shadow-sm hover:border-[#DFD0BE] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-[#F8F3EA] text-[#6B5244] flex items-center justify-center shrink-0">
                    <FileIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#2C1A11] truncate">{file.name}</p>
                    <p className="text-xs text-[#9C8373]">{formatSize(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                  className="p-1 rounded-lg text-[#9C8373] hover:text-[#C23E2A] hover:bg-[#FDEEEB] transition-colors"
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
            className="w-full py-3.5 px-6 rounded-xl btn-primary font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer mt-1"
          >
            <span>Proceed to Pair Devices</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
