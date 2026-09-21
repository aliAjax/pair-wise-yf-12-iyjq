// 停泵检修业务规则模块：纯函数，不依赖 Vue / localStorage，可独立测试。
// 两条核心拒单规则：
// 1. 同一泵位与在修工单时间重叠；
// 2. 本站库存低于一万升，且同区没有可代售的营业站。

export type StationStatus = "营业中" | "暂停营业" | "库存紧张" | "待复核";

export type OrderStatus =
  | "检修中"
  | "已取消"
  | "已完工"
  | "待复核"
  | "已复核";

export interface Station {
  id: string;
  name: string;
  area: string;
  stock: number;
  manager: string;
  pumps: string[];
  status: StationStatus;
}

export interface MaintenanceOrder {
  id: string;
  stationId: string;
  pumpCode: string;
  /** 申报起始时间 ISO */
  startTime: string;
  /** 申报完工时间 ISO */
  endTime: string;
  /** 同区代售站 id，库存不足时必填 */
  proxyStationId: string;
  remark: string;
  status: OrderStatus;
  /** 登记前站点状态，完工/取消/复核后用于恢复 */
  stationStatusBefore: StationStatus;
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
  overdueNote?: string;
  reviewedAt?: string;
}

export interface OrderDraft {
  stationId: string;
  pumpCode: string;
  /** datetime-local 或 ISO 字符串 */
  startTime: string;
  endTime: string;
  proxyStationId?: string;
  remark?: string;
}

export type DraftCheck = { ok: true } | { ok: false; reason: string };

export const STOCK_LIMIT = 10_000;

/** 占用泵位的工单状态：只有「检修中」占用泵位并压制站点营业状态 */
export const ACTIVE_ORDER_STATUS = "检修中" as const;

/** 营业态：库存紧张仍可营业、可代售；暂停营业 / 待复核不可 */
export const OPERATING_STATUSES: readonly StationStatus[] = ["营业中", "库存紧张"];

export function isOperating(station: Station): boolean {
  return (OPERATING_STATUSES as readonly string[]).includes(station.status);
}

/** 同区可代售营业站：与本站不同、同区域、当前营业中（含库存紧张） */
export function eligibleProxies(station: Station, stations: Station[]): Station[] {
  return stations.filter(
    (item) => item.id !== station.id && item.area === station.area && isOperating(item)
  );
}

/** datetime-local / ISO → 毫秒；无法解析返回 null */
export function toTime(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** 半开区间重叠判定：[start, end) 相交即冲突，首尾相接不算重叠 */
export function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

/** 查找同一泵位时间重叠的在修工单 */
export function findOverlappingOrder(
  draft: OrderDraft,
  orders: MaintenanceOrder[]
): MaintenanceOrder | undefined {
  const start = toTime(draft.startTime);
  const end = toTime(draft.endTime);
  if (start === null || end === null) return undefined;
  return orders.find((order) => {
    if (order.status !== ACTIVE_ORDER_STATUS) return false;
    if (order.stationId !== draft.stationId || order.pumpCode !== draft.pumpCode) return false;
    const otherStart = toTime(order.startTime);
    const otherEnd = toTime(order.endTime);
    if (otherStart === null || otherEnd === null) return false;
    return rangesOverlap(start, end, otherStart, otherEnd);
  });
}

/**
 * 检修单登记校验。任一规则不通过即整单拒绝：
 * 调用方拿到 { ok:false } 时不得写入工单、不得改动站点状态。
 */
export function validateDraft(
  draft: OrderDraft,
  stations: Station[],
  orders: MaintenanceOrder[]
): DraftCheck {
  const station = stations.find((item) => item.id === draft.stationId);
  if (!station) return { ok: false, reason: "油站不存在，无法登记检修单" };

  if (!station.pumps.includes(draft.pumpCode)) {
    return { ok: false, reason: `泵位「${draft.pumpCode || "未选择"}」不属于${station.name}` };
  }

  const start = toTime(draft.startTime);
  const end = toTime(draft.endTime);
  if (start === null || end === null) {
    return { ok: false, reason: "请填写有效的起止时间" };
  }
  if (start >= end) {
    return { ok: false, reason: "起始时间必须早于完工时间" };
  }

  const overlap = findOverlappingOrder(draft, orders);
  if (overlap) {
    return {
      ok: false,
      reason: `泵位「${draft.pumpCode}」与检修单 ${overlap.id} 时间重叠（${formatRange(
        overlap.startTime,
        overlap.endTime
      )}），整单拒绝`
    };
  }

  if (station.stock < STOCK_LIMIT) {
    const proxies = eligibleProxies(station, stations);
    if (proxies.length === 0) {
      return {
        ok: false,
        reason: `本站库存 ${station.stock} 升低于 ${STOCK_LIMIT.toLocaleString()} 升，且同区无可代售营业站，整单拒绝`
      };
    }
    if (!draft.proxyStationId) {
      return { ok: false, reason: `库存低于 ${STOCK_LIMIT.toLocaleString()} 升，必须选择同区代售站` };
    }
    const proxy = proxies.find((item) => item.id === draft.proxyStationId);
    if (!proxy) {
      return { ok: false, reason: "代售站必须是同区当前营业的其他站点" };
    }
  }

  return { ok: true };
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} ~ ${formatTime(endIso)}`;
}

export function formatTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
