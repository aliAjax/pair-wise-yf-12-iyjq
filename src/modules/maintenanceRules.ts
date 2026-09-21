// 规则模块：停泵检修的登记校验。只做判断、不改数据，任一规则不满足即整单拒绝。

export type StationStatus = "营业中" | "暂停营业" | "库存紧张" | "待复核";

export const BASE_STATION_STATUSES: StationStatus[] = ["营业中", "暂停营业", "库存紧张"];
export const REVIEW_STATUS: StationStatus = "待复核";

export interface Station {
  id: string;
  station: string;
  area: string;
  stock: number;
  manager: string;
  status: StationStatus;
  notes: string;
  createdAt: string;
}

export type MaintenanceStatus = "检修中" | "已完工" | "已取消";

export interface MaintenanceOrder {
  id: string;
  stationId: string;
  pumpNo: string;
  startAt: string;
  endAt: string;
  substituteId: string;
  status: MaintenanceStatus;
  createdAt: string;
  finishedAt: string;
  overtimeNote: string;
  reviewedAt: string;
}

export interface MaintenanceInput {
  stationId: string;
  pumpNo: string;
  startAt: string;
  endAt: string;
  substituteId: string;
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

export const LOW_STOCK_THRESHOLD = 10000;

const pass: RuleResult = { ok: true };
const reject = (reason: string): RuleResult => ({ ok: false, reason });

export function findStation(stations: Station[], id: string): Station | undefined {
  return stations.find((station) => station.id === id);
}

export function isActiveOrder(order: MaintenanceOrder): boolean {
  return order.status === "检修中";
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// 同一站点同一泵位，检修中的单据时段重叠即占用冲突
export function hasPumpOverlap(orders: MaintenanceOrder[], input: MaintenanceInput): boolean {
  const start = Date.parse(input.startAt);
  const end = Date.parse(input.endAt);
  const pumpNo = input.pumpNo.trim();
  return orders.some(
    (order) =>
      isActiveOrder(order) &&
      order.stationId === input.stationId &&
      order.pumpNo === pumpNo &&
      rangesOverlap(start, end, Date.parse(order.startAt), Date.parse(order.endAt))
  );
}

// 可代售：本站以外、同区域且营业中
export function isValidSubstitute(stations: Station[], station: Station, substituteId: string): boolean {
  if (!substituteId) return false;
  const substitute = findStation(stations, substituteId);
  return Boolean(
    substitute && substitute.id !== station.id && substitute.area === station.area && substitute.status === "营业中"
  );
}

export function hasSubstituteCandidate(stations: Station[], station: Station): boolean {
  return stations.some(
    (candidate) => candidate.id !== station.id && candidate.area === station.area && candidate.status === "营业中"
  );
}

// 登记校验：任一规则不满足即整单拒绝，检修单与站点状态保持原样
export function validateMaintenance(
  stations: Station[],
  orders: MaintenanceOrder[],
  input: MaintenanceInput
): RuleResult {
  const station = findStation(stations, input.stationId);
  if (!station) return reject("请选择检修站点");
  const pumpNo = input.pumpNo.trim();
  if (!pumpNo) return reject("请填写检修泵位");
  const start = Date.parse(input.startAt);
  const end = Date.parse(input.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return reject("请填写完整的起止时间");
  if (end <= start) return reject("申报完工时间需晚于开始时间");
  if (hasPumpOverlap(orders, input)) {
    return reject(`${station.station} ${pumpNo} 在该时段已有检修占用，整单拒绝`);
  }
  if (input.substituteId && !isValidSubstitute(stations, station, input.substituteId)) {
    return reject("代售站需为本站以外、同区域且营业中的站点，整单拒绝");
  }
  if (Number(station.stock) < LOW_STOCK_THRESHOLD && !isValidSubstitute(stations, station, input.substituteId)) {
    return reject(
      hasSubstituteCandidate(stations, station)
        ? `库存低于${LOW_STOCK_THRESHOLD}升，须选择同区营业中的代售站，整单拒绝`
        : `库存低于${LOW_STOCK_THRESHOLD}升且同区无可代售营业站，整单拒绝`
    );
  }
  return pass;
}
