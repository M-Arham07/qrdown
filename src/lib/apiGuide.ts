// QRDown CLI & HTTP API Guide
// Engineered by M-Arham07 (https://github.com/M-Arham07)

export const API_GUIDE_TEXT = `================================================================================
QRDown — Command Line & HTTP File Transfer
Engineered by M-Arham07 (https://github.com/M-Arham07)
Base URL: https://qrdown.vercel.app
================================================================================

1. UPLOAD A FILE
   Send a file from your terminal with curl:
   $ curl -F "file=@document.pdf" https://qrdown.vercel.app/api/cli

2. PIPE STDIN OR SEND TEXT
   Stream piped data or strings directly:
   $ echo "hello world" | curl -F "file=@-" https://qrdown.vercel.app/api/cli
   $ cat archive.tar.gz | curl -F "file=@-" https://qrdown.vercel.app/api/cli

3. DOWNLOAD A FILE
   Download and preserve the remote filename:
   $ curl -sLOJ https://qrdown.vercel.app/api/cli/<TRANSFER_ID>
   
   Or specify custom output path:
   $ curl -sL https://qrdown.vercel.app/api/cli/<TRANSFER_ID> -o output.bin

4. INSPECT METADATA (JSON)
   Fetch file metadata and download link in JSON format:
   $ curl -sH "Accept: application/json" https://qrdown.vercel.app/api/cli/<TRANSFER_ID>

5. DELETE A TRANSFER EARLY
   Purge an upload before expiration:
   $ curl -X DELETE https://qrdown.vercel.app/api/cli/<TRANSFER_ID>

SPECIFICATIONS:
- Max file size: 100 MB
- Default retention: 1 hour (purged automatically)
- Storage: Encrypted Backblaze B2 / S3
- Author: M-Arham07 | Repository: https://github.com/M-Arham07/qrdown
================================================================================
`;

export const API_GUIDE_JSON = {
  service: "QRDown CLI & HTTP Transfer API",
  author: "M-Arham07",
  authorUrl: "https://github.com/M-Arham07",
  repository: "https://github.com/M-Arham07/qrdown",
  endpoints: {
    upload: {
      method: "POST",
      path: "/api/cli",
      description: "Upload a file or piped binary stream.",
      example: 'curl -F "file=@report.pdf" https://qrdown.vercel.app/api/cli',
    },
    download: {
      method: "GET",
      path: "/api/cli/:id",
      description: "Download the file associated with a transfer ID.",
      example: "curl -sLOJ https://qrdown.vercel.app/api/cli/<TRANSFER_ID>",
    },
    metadata: {
      method: "GET",
      path: "/api/cli/:id",
      headers: { Accept: "application/json" },
      description: "Retrieve transfer metadata in JSON format.",
      example: 'curl -sH "Accept: application/json" https://qrdown.vercel.app/api/cli/<TRANSFER_ID>',
    },
    delete: {
      method: "DELETE",
      path: "/api/cli/:id",
      description: "Immediately purge a file from storage.",
      example: "curl -X DELETE https://qrdown.vercel.app/api/cli/<TRANSFER_ID>",
    },
  },
  limits: {
    maxFileSizeBytes: 100 * 1024 * 1024,
    retentionSeconds: 3600,
  },
};
