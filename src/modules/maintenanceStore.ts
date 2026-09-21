// 持久化模块：站点与检修单的本地存取，统一走 localStorage。

export const STATION_STORAGE_KEY = "hxwlfront-21-station-map";
export const ORDER_STORAGE_KEY = "hxwlfront-21-maintenance-orders";

export function loadCollection<T>(key: string, seed: () => T[]): T[] {
  const raw = localStorage.getItem(key);
  if (!raw) return seed();
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return seed();
  }
}

export function saveCollection<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}
