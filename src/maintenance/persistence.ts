// 停泵检修持久化模块：只负责 localStorage 读写与种子数据，
// 不包含任何业务规则。读取到非法数据时回退种子，保证页面可用。

import type { MaintenanceState } from "./flow";
import type { MaintenanceOrder, Station } from "./rules";

const STORAGE_KEY = "hxwlfront-21-maintenance-v1";

function seedStations(): Station[] {
  return [
    {
      id: "S1",
      name: "东区一站",
      area: "东区",
      stock: 36000,
      manager: "刘站长",
      pumps: ["1号泵", "2号泵"],
      status: "暂停营业"
    },
    {
      id: "S2",
      name: "东区二站",
      area: "东区",
      stock: 28000,
      manager: "陈站长",
      pumps: ["1号泵", "2号泵", "3号泵"],
      status: "营业中"
    },
    {
      id: "S3",
      name: "机场快线站",
      area: "机场线",
      stock: 9000,
      manager: "王站长",
      pumps: ["1号泵", "2号泵"],
      status: "待复核"
    },
    {
      id: "S4",
      name: "机场南站",
      area: "机场线",
      stock: 42000,
      manager: "赵站长",
      pumps: ["1号泵", "2号泵"],
      status: "营业中"
    },
    {
      id: "S5",
      name: "西区一站",
      area: "西区",
      stock: 8200,
      manager: "孙站长",
      pumps: ["1号泵", "2号泵"],
      status: "库存紧张"
    },
    {
      id: "S6",
      name: "西区二站",
      area: "西区",
      stock: 31000,
      manager: "周站长",
      pumps: ["1号泵"],
      status: "暂停营业"
    }
  ];
}

function isoDaysAgo(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function isoDaysAhead(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function seedOrders(): MaintenanceOrder[] {
  return [
    {
      id: "M-SEED-1",
      stationId: "S1",
      pumpCode: "2号泵",
      startTime: isoDaysAgo(0, 8),
      endTime: isoDaysAhead(1, 18),
      proxyStationId: "",
      remark: "2号泵渗漏，例行停泵检修",
      status: "检修中",
      stationStatusBefore: "营业中",
      createdAt: isoDaysAgo(0, 7)
    },
    {
      id: "M-SEED-2",
      stationId: "S3",
      pumpCode: "1号泵",
      startTime: isoDaysAgo(3, 8),
      endTime: isoDaysAgo(1, 18),
      proxyStationId: "S4",
      remark: "加油机油气回收部件更换",
      status: "待复核",
      stationStatusBefore: "库存紧张",
      createdAt: isoDaysAgo(3, 7),
      completedAt: isoDaysAgo(0, 10)
    }
  ];
}

function isState(value: unknown): value is MaintenanceState {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.stations) && Array.isArray(data.orders);
}

export function seedState(): MaintenanceState {
  return { stations: seedStations(), orders: seedOrders() };
}

export function loadState(): MaintenanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) return seedState();
    return parsed as MaintenanceState;
  } catch {
    return seedState();
  }
}

export function saveState(state: MaintenanceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时静默降级，内存态仍可用
  }
}

export function resetState(): MaintenanceState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
