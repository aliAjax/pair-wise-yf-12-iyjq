// 停泵检修状态流转模块：所有改动在传入的状态对象上原地完成（便于 Vue 响应式），
// 规则校验不通过或前置状态不符时不做任何写入，返回失败原因。
// 状态流转：
//   登记  → 站点暂停营业，泵位被「检修中」工单占用
//   取消  → 工单已取消，释放泵位并恢复站点营业
//   完工  → 按时：已完工，释放泵位恢复营业；超时：待复核，站点同步待复核
//   复核  → 补写超时说明且复核通过后，已复核并恢复站点营业

import {
  ACTIVE_ORDER_STATUS,
  type MaintenanceOrder,
  type OrderDraft,
  type Station,
  type StationStatus,
  validateDraft
} from "./rules";

export interface MaintenanceState {
  stations: Station[];
  orders: MaintenanceOrder[];
}

export type ActionResult = { ok: true; orderId: string } | { ok: false; reason: string };

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** 登记检修单：规则通过后占用泵位、站点转暂停营业；失败则原样返回 */
export function registerOrder(state: MaintenanceState, draft: OrderDraft): ActionResult {
  const check = validateDraft(draft, state.stations, state.orders);
  if (!check.ok) return check;

  const station = state.stations.find((item) => item.id === draft.stationId)!;
  const now = new Date().toISOString();
  const order: MaintenanceOrder = {
    id: createId("M"),
    stationId: draft.stationId,
    pumpCode: draft.pumpCode,
    startTime: new Date(draft.startTime).toISOString(),
    endTime: new Date(draft.endTime).toISOString(),
    proxyStationId: draft.proxyStationId || "",
    remark: draft.remark || "",
    status: ACTIVE_ORDER_STATUS,
    stationStatusBefore: station.status,
    createdAt: now
  };

  state.orders.unshift(order);
  station.status = "暂停营业";
  return { ok: true, orderId: order.id };
}

/**
 * 恢复站点营业：仅当该站没有任何在修工单时执行，
 * 恢复为登记前记录的营业态，若记录不可用则回到营业中。
 */
function restoreStationIfFree(state: MaintenanceState, stationId: string): void {
  const stillActive = state.orders.some(
    (order) => order.stationId === stationId && order.status === ACTIVE_ORDER_STATUS
  );
  if (stillActive) return;
  const station = state.stations.find((item) => item.id === stationId);
  if (!station) return;
  const operatingBefore: StationStatus[] = ["营业中", "库存紧张"];
  const recorded = state.orders
    .filter((order) => order.stationId === stationId)
    .map((order) => order.stationStatusBefore)
    .reverse()
    .find((status) => operatingBefore.includes(status));
  station.status = recorded ?? "营业中";
}

/** 取消检修：释放泵位、站点恢复营业 */
export function cancelOrder(state: MaintenanceState, orderId: string): ActionResult {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return { ok: false, reason: "检修单不存在" };
  if (order.status !== ACTIVE_ORDER_STATUS) {
    return { ok: false, reason: `当前状态为「${order.status}」，不能取消` };
  }

  order.status = "已取消";
  order.cancelledAt = new Date().toISOString();
  restoreStationIfFree(state, order.stationId);
  return { ok: true, orderId };
}

/**
 * 完工登记：完工时间晚于申报完工时间时进入待复核；
 * 按时完工直接释放泵位恢复营业。
 */
export function completeOrder(
  state: MaintenanceState,
  orderId: string,
  completedAtLocal: string
): ActionResult {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return { ok: false, reason: "检修单不存在" };
  if (order.status !== ACTIVE_ORDER_STATUS) {
    return { ok: false, reason: `当前状态为「${order.status}」，不能登记完工` };
  }
  const completedMs = new Date(completedAtLocal).getTime();
  if (!completedAtLocal || Number.isNaN(completedMs)) {
    return { ok: false, reason: "请填写实际完工时间" };
  }

  order.completedAt = new Date(completedMs).toISOString();
  const overdue = completedMs > new Date(order.endTime).getTime();
  if (overdue) {
    order.status = "待复核";
    const station = state.stations.find((item) => item.id === order.stationId);
    if (station) station.status = "待复核";
  } else {
    order.status = "已完工";
    restoreStationIfFree(state, order.stationId);
  }
  return { ok: true, orderId };
}

/** 复核通过：必须先补写超时说明，之后释放泵位、站点恢复营业 */
export function reviewOrder(
  state: MaintenanceState,
  orderId: string,
  overdueNote: string
): ActionResult {
  const note = overdueNote.trim();
  if (!note) return { ok: false, reason: "复核前必须补写超时说明" };

  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return { ok: false, reason: "检修单不存在" };
  if (order.status !== "待复核") {
    return { ok: false, reason: `当前状态为「${order.status}」，不能复核` };
  }

  order.overdueNote = note;
  order.status = "已复核";
  order.reviewedAt = new Date().toISOString();
  restoreStationIfFree(state, order.stationId);
  return { ok: true, orderId };
}

// ---- 列表与三项统计（与状态、持久化同源同步） ----

export interface MaintenanceMetrics {
  /** 检修中工单数 */
  activeOrders: number;
  /** 当前被占用的泵位数 */
  occupiedPumps: number;
  /** 待复核工单数 */
  pendingReviews: number;
}

export function calcMetrics(state: MaintenanceState): MaintenanceMetrics {
  const active = state.orders.filter((order) => order.status === ACTIVE_ORDER_STATUS);
  const occupied = new Set(active.map((order) => `${order.stationId}#${order.pumpCode}`));
  return {
    activeOrders: active.length,
    occupiedPumps: occupied.size,
    pendingReviews: state.orders.filter((order) => order.status === "待复核").length
  };
}

/** 当前占用某泵位的在修工单（列表高亮用） */
export function activeOrderForPump(
  state: MaintenanceState,
  stationId: string,
  pumpCode: string
): MaintenanceOrder | undefined {
  return state.orders.find(
    (order) =>
      order.status === ACTIVE_ORDER_STATUS &&
      order.stationId === stationId &&
      order.pumpCode === pumpCode
  );
}
