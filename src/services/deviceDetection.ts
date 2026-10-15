import { DeviceInfo } from "@/types/session";
import { nanoid } from "nanoid";

const DEVICE_STORAGE_KEY = "websend_device_info";

export function getDeviceInfo(): DeviceInfo {
  if (typeof window === "undefined") {
    return {
      id: "server-device",
      name: "WebSend Device",
      isMobile: false,
    };
  }

  try {
    const saved = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }

  const ua = navigator.userAgent;
  let os = "Desktop";
  let isMobile = false;

  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = /iPad/i.test(ua) ? "iPad" : "iPhone";
    isMobile = true;
  } else if (/Android/i.test(ua)) {
    os = "Android";
    isMobile = true;
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "Mac";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let browser = "Browser";
  if (/Chrome/i.test(ua) && !/Edge|Edg|OPR/i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Safari";
  } else if (/Firefox/i.test(ua)) {
    browser = "Firefox";
  } else if (/Edg/i.test(ua)) {
    browser = "Edge";
  }

  const device: DeviceInfo = {
    id: nanoid(8),
    name: `${browser} on ${os}`,
    os,
    browser,
    isMobile,
  };

  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device));
  } catch {
    // ignore
  }

  return device;
}

export function updateDeviceName(newName: string): DeviceInfo {
  const current = getDeviceInfo();
  const updated = { ...current, name: newName.trim() || current.name };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }
  return updated;
}
