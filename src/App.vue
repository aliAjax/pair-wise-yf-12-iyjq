<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  activeOrderForPump,
  calcMetrics,
  cancelOrder,
  completeOrder,
  registerOrder,
  reviewOrder,
  type ActionResult,
  type MaintenanceState
} from "./maintenance/flow";
import {
  ACTIVE_ORDER_STATUS,
  eligibleProxies,
  formatTime,
  STOCK_LIMIT,
  type MaintenanceOrder,
  type OrderStatus,
  type Station,
  type StationStatus
} from "./maintenance/rules";
import { loadState, resetState, saveState } from "./maintenance/persistence";

const AREAS = ["东区", "西区", "机场线"] as const;
const AREA_FILTERS = ["全部区域", ...AREA] as const;
const STATION_STATUSES: readonly StationStatus[] = ["营业中", "暂停营业", "库存紧张", "待复核"];
const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  检修中: "st-active",
  已取消: "st-cancelled",
  已完工: "st-done",
  待复核: "st-review",
  已复核: "st-reviewed"
};

const state = reactive<MaintenanceState>(loadState());
watch(state, () => saveState(state), { deep: true });

const metrics = computed(() => calcMetrics(state));

const statusChart = computed(() => {
  const statuses: OrderStatus[] = ["检修中", "待复核", "已完工", "已复核", "已取消"];
  return statuses.map((status) => ({
    status,
    value: state.orders.filter((order) => order.status === status).length
  }));
});
const maxChart = computed(() => Math.max(1, ...statusChart.value.map((row) => row.value)));

function stationName(id: string): string {
  return state.stations.find((item) => item.id === id)?.name ?? "（站点已删除）";
}

// ---------- 检修登记表单 ----------
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function defaultWindow() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 8 * 3600000);
  return { start: toLocalInput(start.toISOString()), end: toLocalInput(end.toISOString()) };
}

const initialWindow = defaultWindow();
const draft = reactive({
  stationId: "",
  pumpCode: "",
  startTime: initialWindow.start,
  endTime: initialWindow.end,
  proxyStationId: "",
  remark: ""
});

const draftStation = computed<Station | undefined>(() =>
  state.stations.find((item) => item.id === draft.stationId)
);
const draftPumps = computed(() => draftStation.value?.pumps ?? []);
const draftProxies = computed(() =>
  draftStation.value ? eligibleProxies(draftStation.value, state.stations) : []
);
const proxyRequired = computed(() => (draftStation.value?.stock ?? Infinity) < STOCK_LIMIT);
const formError = ref("");
const formOk = ref("");

function onDraftStationChange() {
  draft.pumpCode = "";
  draft.proxyStationId = "";
}

function submitOrder() {
  formOk.value = "";
  const result: ActionResult = registerOrder(state, { ...draft });
  if (!result.ok) {
    formError.value = result.reason;
    return;
  }
  formError.value = "";
  formOk.value = `检修单 ${result.orderId} 已登记，泵位占用、站点暂停营业`;
  draft.pumpCode = "";
  draft.proxyStationId = "";
  draft.remark = "";
}

// ---------- 列表过滤 ----------
type Tab = "orders" | "stations";
const tab = ref<Tab>("orders");
const areaFilter = ref<string>("全部区域");
const orderFilter = ref<"全部" | OrderStatus>("全部");

const visibleStations = computed(() =>
  areaFilter.value.startsWith("全部")
    ? state.stations
    : state.stations.filter((station) => station.area === areaFilter.value)
);

const visibleOrders = computed(() => {
  const allowedStationIds = new Set(visibleStations.value.map((station) => station.id));
  return state.orders
    .filter((order) => allowedStationIds.has(order.stationId))
    .filter((order) => orderFilter.value === "全部" || order.status === orderFilter.value);
});

// ---------- 取消 / 完工 / 复核 ----------
const completingId = ref("");
const completedAtInput = ref(toLocalInput(new Date().toISOString()));
const completeError = ref("");
const reviewingId = ref("");
const reviewNotes = reactive<Record<string, string>>({});
const reviewErrors = reactive<Record<string, string>>({});
const actionMessage = ref("");

function startComplete(order: MaintenanceOrder) {
  completingId.value = order.id;
  completedAtInput.value = toLocalInput(new Date().toISOString());
  completeError.value = "";
}

function submitComplete(order: MaintenanceOrder) {
  const result = completeOrder(state, order.id, completedAtInput.value);
  if (!result.ok) {
    completeError.value = result.reason;
    return;
  }
  completingId.value = "";
  actionMessage.value =
    order.status === "待复核"
      ? `完工晚于申报时间，${stationName(order.stationId)}进入待复核，请补写超时说明`
      : "按时完工，泵位已释放，站点恢复营业";
}

function doCancel(order: MaintenanceOrder) {
  const result = cancelOrder(state, order.id);
  if (result.ok) actionMessage.value = "检修已取消，泵位释放、站点恢复营业";
  else actionMessage.value = result.reason;
}

function doReview(order: MaintenanceOrder) {
  const result = reviewOrder(state, order.id, reviewNotes[order.id] ?? "");
  if (result.ok) {
    reviewingId.value = "";
    reviewNotes[order.id] = "";
    reviewErrors[order.id] = "";
    actionMessage.value = "复核通过，站点恢复营业";
  } else {
    reviewErrors[order.id] = result.reason;
  }
}

// ---------- 新增油站 ----------
const stationForm = reactive({ name: "", area: String(AREAS[0]), stock: 20000, manager: "" });
const stationError = ref("");

function addStation() {
  stationError.value = "";
  const name = stationForm.name.trim();
  if (!name) {
    stationError.value = "请填写油站名称";
    return;
  }
  if (Number(stationForm.stock) < 0) {
    stationError.value = "库存不能为负数";
    return;
  }
  const station: Station = {
    id: `S-${Date.now()}`,
    name,
    area: stationForm.area,
    stock: Number(stationForm.stock),
    manager: stationForm.manager.trim() || "未指定",
    pumps: ["1号泵", "2号泵"],
    status: Number(stationForm.stock) < STOCK_LIMIT ? "库存紧张" : "营业中"
  };
  state.stations.push(station);
  stationForm.name = "";
  stationForm.stock = 20000;
  stationForm.manager = "";
  actionMessage.value = `油站「${station.name}」已加入网点`;
}

function removeStation(station: Station) {
  const active = state.orders.some(
    (order) => order.stationId === station.id && order.status === ACTIVE_ORDER_STATUS
  );
  if (active) {
    actionMessage.value = `${station.name}存在检修中工单，不能删除`;
    return;
  }
  state.stations = state.stations.filter((item) => item.id !== station.id);
  actionMessage.value = `油站「${station.name}」已删除`;
}

function resetAll() {
  const seeded = resetState();
  state.stations = seeded.stations;
  state.orders = seeded.orders;
  actionMessage.value = "已恢复演示数据";
  formError.value = "";
  formOk.value = "";
}

function pumpOccupied(station: Station, pump: string): boolean {
  return Boolean(activeOrderForPump(state, station.id, pump));
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环 · 停泵检修</p>
          <h1>油站网点地图管理</h1>
          <p class="subtitle">
            登记停泵检修单占用泵位与代售站；同泵位时间重叠或低库存且同区无代售营业站时整单拒绝。
            取消即释放，超时完工进待复核，补写说明复核通过后恢复营业。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage</span>
          <button class="secondary reset-btn" type="button" @click="resetAll">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>检修中工单</span>
          <strong>{{ metrics.activeOrders }}</strong>
        </article>
        <article class="metric">
          <span>占用泵位</span>
          <strong>{{ metrics.occupiedPumps }}</strong>
        </article>
        <article class="metric">
          <span>待复核</span>
          <strong :class="{ warn: metrics.pendingReviews > 0 }">{{ metrics.pendingReviews }}</strong>
        </article>
      </section>

      <p v-if="actionMessage" class="flash">{{ actionMessage }}</p>

      <section class="workspace">
        <div class="side">
          <!-- 检修登记 -->
          <form class="panel" @submit.prevent="submitOrder">
            <h2>停泵检修登记</h2>
            <div class="form-grid">
              <label>
                检修油站
                <select v-model="draft.stationId" required @change="onDraftStationChange">
                  <option value="">请选择油站</option>
                  <option v-for="station in state.stations" :key="station.id" :value="station.id">
                    {{ station.name }}（{{ station.area }} · 库存 {{ station.stock.toLocaleString() }}L）
                  </option>
                </select>
              </label>
              <label>
                泵位
                <select v-model="draft.pumpCode" required :disabled="!draftStation">
                  <option value="">请选择泵位</option>
                  <option v-for="pump in draftPumps" :key="pump" :value="pump">
                    {{ pump }}{{ pumpOccupied(draftStation!, pump) ? "（占用中）" : "" }}
                  </option>
                </select>
              </label>
              <div class="form-row">
                <label>
                  起始时间
                  <input v-model="draft.startTime" type="datetime-local" required />
                </label>
                <label>
                  申报完工时间
                  <input v-model="draft.endTime" type="datetime-local" required />
                </label>
              </div>
              <label>
                同区代售站
                <select v-model="draft.proxyStationId" :required="proxyRequired">
                  <option value="">
                    {{ proxyRequired ? "请选择（库存低于一万升，必填）" : "无需代售（库存充足，可不选）" }}
                  </option>
                  <option v-for="proxy in draftProxies" :key="proxy.id" :value="proxy.id">
                    {{ proxy.name }}（{{ proxy.status }} · {{ proxy.stock.toLocaleString() }}L）
                  </option>
                </select>
              </label>
              <p v-if="proxyRequired && draftProxies.length === 0" class="field-hint danger-hint">
                同区没有营业中的代售站，本单将被整单拒绝。
              </p>
              <p v-else-if="proxyRequired" class="field-hint">
                本站库存低于一万升，登记期间由同区营业站代售。
              </p>
              <label>
                检修说明
                <textarea v-model="draft.remark" placeholder="填写检修内容、现场说明" />
              </label>
              <p v-if="formError" class="form-error">整单拒绝：{{ formError }}</p>
              <p v-if="formOk" class="form-ok">{{ formOk }}</p>
              <button type="submit">登记检修单</button>
            </div>
          </form>

          <!-- 新增油站 -->
          <form class="panel" @submit.prevent="addStation">
            <h2>新增油站网点</h2>
            <div class="form-grid">
              <div class="form-row">
                <label>
                  油站名称
                  <input v-model="stationForm.name" placeholder="如：北区一站" required />
                </label>
                <label>
                  区域
                  <select v-model="stationForm.area">
                    <option v-for="area in AREAS" :key="area" :value="area">{{ area }}</option>
                  </select>
                </label>
              </div>
              <div class="form-row">
                <label>
                  库存（L）
                  <input v-model.number="stationForm.stock" type="number" min="0" step="100" />
                </label>
                <label>
                  负责人
                  <input v-model="stationForm.manager" placeholder="选填" />
                </label>
              </div>
              <p v-if="stationError" class="form-error">{{ stationError }}</p>
              <button type="submit">保存油站</button>
            </div>
          </form>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <div class="tabs">
              <button
                type="button"
                :class="{ secondary: tab !== 'orders' }"
                @click="tab = 'orders'"
              >
                检修单列表
              </button>
              <button
                type="button"
                :class="{ secondary: tab !== 'stations' }"
                @click="tab = 'stations'"
              >
                油站网点（{{ state.stations.length }}）
              </button>
            </div>
            <div class="filters">
              <select v-if="tab === 'orders'" v-model="orderFilter">
                <option value="全部">全部状态</option>
                <option v-for="row in statusChart" :key="row.status" :value="row.status">
                  {{ row.status }}
                </option>
              </select>
              <select v-model="areaFilter">
                <option v-for="item in AREA_FILTERS" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
          </div>

          <!-- 检修单列表 -->
          <div v-if="tab === 'orders'" class="record-grid">
            <div v-if="visibleOrders.length === 0" class="empty">暂无匹配的检修单</div>
            <article v-for="order in visibleOrders" :key="order.id" class="record order-card">
              <div class="record-head">
                <p class="record-title">
                  {{ stationName(order.stationId) }} · {{ order.pumpCode }}
                </p>
                <span class="status" :class="ORDER_STATUS_CLASS[order.status]">{{ order.status }}</span>
              </div>
              <div class="details">
                <span>检修单：{{ order.id }}</span>
                <span>登记：{{ formatTime(order.createdAt) }}</span>
                <span>起止：{{ formatTime(order.startTime) }}</span>
                <span>申报完工：{{ formatTime(order.endTime) }}</span>
                <span>实际完工：{{ formatTime(order.completedAt) }}</span>
                <span>
                  代售站：
                  {{ order.proxyStationId ? stationName(order.proxyStationId) : "无需代售" }}
                </span>
              </div>
              <p class="note">检修说明：{{ order.remark || "—" }}</p>
              <p v-if="order.status === '待复核' || order.overdueNote" class="note overdue-note">
                超时说明：{{ order.overdueNote || "尚未补写，复核前必须补写" }}
              </p>
              <p v-if="order.cancelledAt" class="meta">取消时间：{{ formatTime(order.cancelledAt) }}</p>
              <p v-if="order.reviewedAt" class="meta">复核时间：{{ formatTime(order.reviewedAt) }}</p>

              <div v-if="order.status === '检修中'" class="actions">
                <button type="button" @click="startComplete(order)">登记完工</button>
                <button class="danger" type="button" @click="doCancel(order)">取消检修（释放泵位）</button>
              </div>
              <div v-if="order.status === '待复核'" class="actions">
                <button type="button" @click="reviewingId = reviewingId === order.id ? '' : order.id">
                  {{ reviewingId === order.id ? "收起复核" : "补写超时说明并复核" }}
                </button>
              </div>

              <div v-if="completingId === order.id" class="inline-edit">
                <label>
                  实际完工时间（晚于申报完工 {{ formatTime(order.endTime) }} 将进入待复核）
                  <input v-model="completedAtInput" type="datetime-local" />
                </label>
                <p v-if="completeError" class="form-error">{{ completeError }}</p>
                <div class="actions">
                  <button type="button" @click="submitComplete(order)">确认完工</button>
                  <button class="secondary" type="button" @click="completingId = ''">返回</button>
                </div>
              </div>

              <div v-if="reviewingId === order.id && order.status === '待复核'" class="inline-edit">
                <label>
                  超时说明
                  <textarea
                    v-model="reviewNotes[order.id]"
                    placeholder="说明完工晚于申报时间的原因、现场处置与改进措施"
                  />
                </label>
                <p v-if="reviewErrors[order.id]" class="form-error">{{ reviewErrors[order.id] }}</p>
                <div class="actions">
                  <button type="button" @click="doReview(order)">复核通过，恢复营业</button>
                  <button class="secondary" type="button" @click="reviewingId = ''">返回</button>
                </div>
              </div>
            </article>
          </div>

          <!-- 油站网点列表 -->
          <div v-else class="station-grid">
            <div v-if="visibleStations.length === 0" class="empty">暂无匹配的油站</div>
            <article v-for="station in visibleStations" :key="station.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ station.name }}</p>
                <span class="status" :class="{ 'st-review': station.status === '待复核' }">
                  {{ station.status }}
                </span>
              </div>
              <div class="details">
                <span>区域：{{ station.area }}</span>
                <span>负责人：{{ station.manager }}</span>
                <span
                  :class="{ 'stock-low': station.stock < STOCK_LIMIT }"
                >库存：{{ station.stock.toLocaleString() }} L</span>
                <span>
                  同区代售：
                  {{ eligibleProxies(station, state.stations).map((s) => s.name).join("、") || "无可用营业站" }}
                </span>
              </div>
              <div class="pumps">
                <span
                  v-for="pump in station.pumps"
                  :key="pump"
                  class="pump"
                  :class="{ occupied: pumpOccupied(station, pump) }"
                >
                  {{ pump }}{{ pumpOccupied(station, pump) ? " · 检修占用" : " · 空闲" }}
                </span>
              </div>
              <div class="actions">
                <button class="secondary danger" type="button" @click="removeStation(station)">
                  删除油站
                </button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in statusChart" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
