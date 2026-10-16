// Shared across development route bundles and hot reloads in the same process.
const local = globalThis as typeof globalThis & {
  websendMockStorage?: Map<string, { buffer: ArrayBuffer; contentType: string }>;
};
export const mockStorage = local.websendMockStorage ??= new Map();
