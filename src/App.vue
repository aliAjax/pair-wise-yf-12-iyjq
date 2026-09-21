<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  BASE_STATION_STATUSES,
  LOW_STOCK_THRESHOLD,
  REVIEW_STATUS,
  type MaintenanceOrder,
  type Station,
  type StationStatus,
} from "./modules/maintenanceRules";
import {
  cancelMaintenance,
  completeMaintenance,
  isLateFinish,
  needsReview,
  registerMaintenance,
  reviewMaintenance,
  type FlowResult,
} from "./modules/maintenanceFlow";
import { ORDER_STORAGE_KEY, STATION_STORAGE_KEY, loadCollection, saveCollection } from "./modules/maintenanceStore";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

const project = {
  "number": 21,
  "folder": "hxwl/frontend/hxwlfront-21",
  "framework": "vue",
  "title": "油站网点地图管理",
  "subtitle": "维护油站位置、营业状态和库存摘要，闭环管理停泵检修、代售衔接与完工复核。",
  "industry": "石油",
  "stack": [
    "Vue3",
    "Vite",
    "TypeScript",
    "Element Plus",
    "Leaflet"
  ],
  "storageKey": "hxwlfront-21-station-map",
  "formTitle": "新增油站",
  "primaryAction": "保存油站",
  "entityLabel": "油站",
  "maintenanceTitle": "停泵检修登记",
  "maintenanceAction": "登记检修单",
  "orderLabel": "检修单",
  "statuses": [
    "营业中",
    "暂停营业",
    "库存紧张",
    "待复核"
  ],
  "filters": [
    "全部区域",
    "东区",
    "西区",
    "机场线"
  ],
  "fields": [
    {
      "key": "station",
      "label": "油站名称"
    },
    {
      "key": "area",
      "label": "区域",
      "type": "select",
      "options": [
        "东区",
        "西区",
        "机场线"
      ]
    },
    {
      "key": "stock",
      "label": "库存摘要L",
      "type": "number"
    },
    {
      "key": "manager",
      "label": "负责人"
    }
  ],
  "records": [
    {
      "station": "东区一站",
      "area": "东区",
      "stock": 36000,
      "manager": "刘站长",
      "status": "营业中",
      "notes": "库存正常"
    },
    {
      "station": "东区二站",
      "area": "东区",
      "stock": 22000,
      "manager": "陈站长",
      "status": "营业中",
      "notes": "东区备用代售站"
    },
    {
      "station": "西区中心站",
      "area": "西区",
      "stock": 15000,
      "manager": "赵站长",
      "status": "营业中",
      "notes": "西区枢纽站"
    },
    {
      "station": "机场快线站",
      "area": "机场线",
      "stock": 9000,
      "manager": "王站长",
      "status": "库存紧张",
      "notes": "柴油待补"
    }
  ],
  "metricLabels": [
    "油站数",
    "检修中泵位",
    "待复核站点"
  ]
} as const;

const fields = project.fields as readonly Field[];
const statuses = [...project.statuses];

function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

function seedStations(): Station[] {
  return project.records.map((record, index) => ({
    ...record,
    id: `seed-${index + 1}`,
    createdAt: new Date(Date.now() - index * 86400000).toISOString()
  })) as Station[];
}

// 首次启动补一单检修中的演示数据；已有本地数据时不造单
function seedOrders(list: Station[]): MaintenanceOrder[] {
  const main = list.find((station) => station.id === "seed-1");
  const backup = list.find(
    (station) => main && station.id !== main.id && station.area === main.area && station.status === "营业中"
  );
  if (!main || !backup) return [];
  const now = Date.now();
  main.status = "暂停营业";
  main.notes = "2号泵检修占用中";
  return [
    {
      id: "order-seed-1",
      stationId: main.id,
      pumpNo: "2号泵",
      startAt: new Date(now - 2 * 86400000).toISOString(),
      endAt: new Date(now + 86400000).toISOString(),
      substituteId: backup.id,
      status: "检修中",
      createdAt: new Date(now - 2 * 86400000).toISOString(),
      finishedAt: "",
      overtimeNote: "",
      reviewedAt: ""
    }
  ];
}

const stations = ref<Station[]>(loadCollection(STATION_STORAGE_KEY, seedStations));
const orders = ref<MaintenanceOrder[]>(loadCollection(ORDER_STORAGE_KEY, () => seedOrders(stations.value)));

const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(project.filters[0]);
const notice = ref("");

const maintenanceForm = reactive({
  stationId: "",
  pumpNo: "",
  startAt: "",
  endAt: "",
  substituteId: ""
});
const maintenanceError = ref("");
const reviewNotes = reactive<Record<string, string>>({});

const filteredStations = computed(() => {
  if (filter.value.startsWith("全部")) return stations.value;
  return stations.value.filter((station) => Object.values(station).includes(filter.value));
});

const metrics = computed(() => [
  stations.value.length,
  orders.value.filter((order) => order.status === "检修中").length,
  stations.value.filter((station) => station.status === REVIEW_STATUS).length
]);

const chartRows = computed(() => statuses.map((status) => ({
  status,
  value: stations.value.filter((station) => station.status === status).length
})));

const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

const selectedStation = computed(() => stations.value.find((station) => station.id === maintenanceForm.stationId));

const substituteOptions = computed(() => {
  const station = selectedStation.value;
  if (!station) return [];
  return stations.value.filter(
    (candidate) => candidate.id !== station.id && candidate.area === station.area && candidate.status === "营业中"
  );
});

function persist() {
  saveCollection(STATION_STORAGE_KEY, stations.value);
  saveCollection(ORDER_STORAGE_KEY, orders.value);
}

function applyFlow(result: FlowResult) {
  notice.value = result.ok ? result.message : result.reason;
  if (result.ok) persist();
}

function nextStatus(status: StationStatus): StationStatus {
  if (status === REVIEW_STATUS) return status;
  const index = BASE_STATION_STATUSES.indexOf(status);
  return BASE_STATION_STATUSES[(index + 1) % BASE_STATION_STATUSES.length] ?? BASE_STATION_STATUSES[0];
}

function primaryText(station: Station) {
  const first = fields[0];
  const second = fields[1];
  return [station[first.key as keyof Station], station[second.key as keyof Station]].filter(Boolean).join(" / ") || project.entityLabel;
}

function stationName(id: string) {
  return stations.value.find((station) => station.id === id)?.station ?? "已删除站点";
}

function fmtTime(iso: string) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function statusClass(status: string) {
  if (status === "暂停营业") return "pause";
  if (status === "库存紧张") return "low";
  if (status === REVIEW_STATUS) return "review";
  return "";
}

function orderStatusClass(status: MaintenanceOrder["status"]) {
  if (status === "检修中") return "pause";
  if (status === "已取消") return "cancelled";
  return "";
}

function submitStation() {
  const station = {
    ...form,
    stock: Number(form.stock) || 0,
    id: crypto.randomUUID(),
    status: "营业中",
    notes: note.value || "暂无备注",
    createdAt: new Date().toISOString()
  } as Station;
  stations.value = [station, ...stations.value];
  Object.assign(form, createBlank());
  note.value = "";
  notice.value = "油站已保存";
  persist();
}

function submitMaintenance() {
  const result = registerMaintenance(stations.value, orders.value, { ...maintenanceForm });
  if (!result.ok) {
    maintenanceError.value = result.reason;
    return;
  }
  maintenanceError.value = "";
  Object.assign(maintenanceForm, { stationId: "", pumpNo: "", startAt: "", endAt: "", substituteId: "" });
  applyFlow(result);
}

function cancelOrder(order: MaintenanceOrder) {
  applyFlow(cancelMaintenance(stations.value, orders.value, order.id));
}

function completeOrder(order: MaintenanceOrder) {
  applyFlow(completeMaintenance(stations.value, orders.value, order.id));
}

function submitReview(order: MaintenanceOrder) {
  const result = reviewMaintenance(stations.value, orders.value, order.id, reviewNotes[order.id] ?? "");
  if (result.ok) delete reviewNotes[order.id];
  applyFlow(result);
}

function flow(station: Station) {
  if (station.status === REVIEW_STATUS) return;
  station.status = nextStatus(station.status);
  persist();
}

function copySummary(station: Station) {
  void navigator.clipboard?.writeText(primaryText(station));
  notice.value = "摘要已复制";
}

function removeStation(id: string) {
  if (orders.value.some((order) => order.stationId === id && order.status === "检修中")) {
    notice.value = "该站点存在检修中的单据，请先完工或取消检修";
    return;
  }
  stations.value = stations.value.filter((station) => station.id !== id);
  notice.value = "油站已删除";
  persist();
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <p v-if="notice" class="notice">{{ notice }}</p>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="submitStation">
            <h2>{{ project.formTitle }}</h2>
            <div class="form-grid">
              <label v-for="field in fields" :key="field.key">
                {{ field.label }}
                <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                  <option value="">请选择</option>
                  <option v-for="option in field.options" :key="option">{{ option }}</option>
                </select>
                <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
              </label>
              <label>
                备注
                <textarea v-model="note" placeholder="填写处理说明或现场备注" />
              </label>
              <button type="submit">{{ project.primaryAction }}</button>
            </div>
          </form>

          <form class="panel" @submit.prevent="submitMaintenance">
            <h2>{{ project.maintenanceTitle }}</h2>
            <div class="form-grid">
              <label>
                检修站点
                <select v-model="maintenanceForm.stationId" required @change="maintenanceForm.substituteId = ''">
                  <option value="">请选择</option>
                  <option v-for="station in stations" :key="station.id" :value="station.id">
                    {{ station.station }}（{{ station.area }}）
                  </option>
                </select>
              </label>
              <label>
                泵位
                <input v-model="maintenanceForm.pumpNo" placeholder="如：2号泵" required />
              </label>
              <label>
                开始时间
                <input v-model="maintenanceForm.startAt" type="datetime-local" required />
              </label>
              <label>
                申报完工时间
                <input v-model="maintenanceForm.endAt" type="datetime-local" required />
              </label>
              <label>
                同区代售站
                <select v-model="maintenanceForm.substituteId">
                  <option value="">无代售站</option>
                  <option v-for="station in substituteOptions" :key="station.id" :value="station.id">
                    {{ station.station }}（{{ station.status }}）
                  </option>
                </select>
              </label>
              <p v-if="selectedStation && Number(selectedStation.stock) < LOW_STOCK_THRESHOLD" class="hint">
                该站库存 {{ selectedStation.stock }}L，低于 {{ LOW_STOCK_THRESHOLD }}L，须选择同区营业中代售站，否则整单拒绝。
              </p>
              <p v-if="maintenanceError" class="error-text">{{ maintenanceError }}</p>
              <button type="submit">{{ project.maintenanceAction }}</button>
            </div>
          </form>
        </div>

        <div class="side">
          <section class="list-panel">
            <div class="toolbar">
              <h2>{{ project.entityLabel }}列表</h2>
              <select v-model="filter">
                <option v-for="item in project.filters" :key="item">{{ item }}</option>
              </select>
            </div>

            <div class="record-grid">
              <div v-if="filteredStations.length === 0" class="empty">暂无匹配数据</div>
              <article v-for="station in filteredStations" :key="station.id" class="record">
                <div class="record-head">
                  <p class="record-title">{{ primaryText(station) }}</p>
                  <span class="status" :class="statusClass(station.status)">{{ station.status }}</span>
                </div>
                <div class="details">
                  <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ station[field.key as keyof Station] }}</span>
                </div>
                <p class="note">{{ station.notes }}</p>
                <div class="actions">
                  <button type="button" :disabled="station.status === REVIEW_STATUS" @click="flow(station)">
                    {{ station.status === REVIEW_STATUS ? "待检修复核" : "流转状态" }}
                  </button>
                  <button class="secondary" type="button" @click="copySummary(station)">复制摘要</button>
                  <button class="danger" type="button" @click="removeStation(station.id)">删除</button>
                </div>
              </article>
            </div>

            <div class="mini-chart">
              <div v-for="row in chartRows" :key="row.status" class="bar">
                <span>{{ row.status }}</span>
                <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
                <strong>{{ row.value }}</strong>
              </div>
            </div>
          </section>

          <section class="list-panel">
            <div class="toolbar">
              <h2>{{ project.orderLabel }}列表</h2>
              <span class="toolbar-meta">共 {{ orders.length }} 单</span>
            </div>

            <div class="record-grid">
              <div v-if="orders.length === 0" class="empty">暂无检修单</div>
              <article v-for="order in orders" :key="order.id" class="record">
                <div class="record-head">
                  <p class="record-title">{{ stationName(order.stationId) }} / {{ order.pumpNo }}</p>
                  <div class="head-tags">
                    <span v-if="isLateFinish(order)" class="late-tag">超时完工</span>
                    <span class="status" :class="orderStatusClass(order.status)">{{ order.status }}</span>
                  </div>
                </div>
                <div class="details">
                  <span>开始时间: {{ fmtTime(order.startAt) }}</span>
                  <span>申报完工: {{ fmtTime(order.endAt) }}</span>
                  <span>代售站: {{ order.substituteId ? stationName(order.substituteId) : "无" }}</span>
                  <span>实际完工: {{ order.finishedAt ? fmtTime(order.finishedAt) : "—" }}</span>
                </div>
                <p v-if="order.overtimeNote" class="note">
                  超时说明：{{ order.overtimeNote }}<template v-if="order.reviewedAt">（复核于 {{ fmtTime(order.reviewedAt) }}）</template>
                </p>
                <div v-if="order.status === '检修中'" class="actions">
                  <button type="button" @click="completeOrder(order)">完工</button>
                  <button class="danger" type="button" @click="cancelOrder(order)">取消检修</button>
                </div>
                <div v-else-if="needsReview(order)" class="review-box">
                  <p class="hint">完工晚于申报时间，站点待复核，请补写超时说明：</p>
                  <textarea v-model="reviewNotes[order.id]" placeholder="填写超时原因与现场处理说明" />
                  <div class="actions">
                    <button type="button" @click="submitReview(order)">复核通过</button>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </section>
    </div>
  </main>
</template>
