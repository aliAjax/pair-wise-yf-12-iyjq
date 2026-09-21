// 状态流转模块：检修单登记、取消、完工、复核，以及站点状态的联动。

import {
  REVIEW_STATUS,
  findStation,
  isActiveOrder,
  validateMaintenance,
  type MaintenanceInput,
  type MaintenanceOrder,
  type Station,
} from "./maintenanceRules";

export type FlowResult = { ok: true; message: string } | { ok: false; reason: string };

const done = (message: string): FlowResult => ({ ok: true, message });
const fail = (reason: string): FlowResult => ({ ok: false, reason });

export function isLateFinish(order: MaintenanceOrder): boolean {
  return Boolean(order.finishedAt) && Date.parse(order.finishedAt) > Date.parse(order.endAt);
}

export function needsReview(order: MaintenanceOrder): boolean {
  return order.status === "已完工" && isLateFinish(order) && !order.reviewedAt;
}

// 站点状态跟随其检修单：有占用则暂停营业，有超时待复核则待复核，否则恢复营业
function syncStationStatus(stations: Station[], orders: MaintenanceOrder[], stationId: string): void {
  const station = findStation(stations, stationId);
  if (!station) return;
  const occupied = orders.some((order) => order.stationId === stationId && isActiveOrder(order));
  const reviewing = orders.some((order) => order.stationId === stationId && needsReview(order));
  station.status = occupied ? "暂停营业" : reviewing ? REVIEW_STATUS : "营业中";
}

// 登记：先过规则校验，拒绝时不落单、不动站点状态
export function registerMaintenance(
  stations: Station[],
  orders: MaintenanceOrder[],
  input: MaintenanceInput
): FlowResult {
  const check = validateMaintenance(stations, orders, input);
  if (!check.ok) return fail(check.reason);
  const order: MaintenanceOrder = {
    id: crypto.randomUUID(),
    stationId: input.stationId,
    pumpNo: input.pumpNo.trim(),
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
    substituteId: input.substituteId,
    status: "检修中",
    createdAt: new Date().toISOString(),
    finishedAt: "",
    overtimeNote: "",
    reviewedAt: "",
  };
  orders.unshift(order);
  syncStationStatus(stations, orders, order.stationId);
  return done("检修单已登记，泵位占用，站点暂停营业");
}

// 取消：单据作废，泵位立即释放
export function cancelMaintenance(stations: Station[], orders: MaintenanceOrder[], orderId: string): FlowResult {
  const order = orders.find((item) => item.id === orderId);
  if (!order || !isActiveOrder(order)) return fail("仅检修中的检修单可取消");
  order.status = "已取消";
  syncStationStatus(stations, orders, order.stationId);
  const station = findStation(stations, order.stationId);
  return done(station?.status === "营业中" ? "检修单已取消，泵位释放，站点恢复营业" : "检修单已取消，泵位释放");
}

// 完工：晚于申报完工时间的，站点进入待复核
export function completeMaintenance(
  stations: Station[],
  orders: MaintenanceOrder[],
  orderId: string,
  finishedAt: Date = new Date()
): FlowResult {
  const order = orders.find((item) => item.id === orderId);
  if (!order || !isActiveOrder(order)) return fail("仅检修中的检修单可完工");
  order.status = "已完工";
  order.finishedAt = finishedAt.toISOString();
  syncStationStatus(stations, orders, order.stationId);
  return isLateFinish(order)
    ? done("完工晚于申报时间，站点进入待复核，请补写超时说明")
    : done("检修完工，泵位释放");
}

// 复核：补写超时说明后复核通过，站点恢复营业
export function reviewMaintenance(
  stations: Station[],
  orders: MaintenanceOrder[],
  orderId: string,
  note: string
): FlowResult {
  const order = orders.find((item) => item.id === orderId);
  if (!order || !needsReview(order)) return fail("该检修单无需复核");
  if (!note.trim()) return fail("请先补写超时说明再复核");
  order.overtimeNote = note.trim();
  order.reviewedAt = new Date().toISOString();
  syncStationStatus(stations, orders, order.stationId);
  const station = findStation(stations, order.stationId);
  return done(station?.status === "营业中" ? "复核通过，站点恢复营业" : "复核通过，超时说明已归档");
}
