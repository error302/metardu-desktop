import { useState, useEffect } from "react";
export function usePlatform(): "electron" | "tauri" | "browser" {
  const [p, setP] = useState<"electron"|"tauri"|"browser">("browser");
  useEffect(() => {
    if (typeof window !== "undefined") {
      if ("__TAURI_INTERNALS__" in window) setP("tauri");
      else if ("metardu" in window) setP("electron");
    }
  }, []);
  return p;
}
export function useApi() {
  const [api, setApi] = useState<any>(null);
  useEffect(() => {
    if (typeof window !== "undefined" && "metardu" in window) setApi((window as any).metardu);
  }, []);
  return api;
}
