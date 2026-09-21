# 油站网点地图管理

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Element Plus、Leaflet
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

这是一个功能最小闭环前端项目，数据默认保存在浏览器localStorage中，方便后续扩展接口、权限、图表或地图能力。

## 停泵检修闭环

- 检修单登记泵位、起止时间与同区代售站；同一泵位时段重叠，或本站库存低于一万升且同区无可代售营业站时整单拒绝，检修单与站点状态保持原样。
- 取消检修即释放泵位；完工晚于申报时间站点进入待复核，补写超时说明并复核通过后恢复营业。
- 业务代码拆为三个模块：`src/modules/maintenanceRules.ts`（规则校验）、`src/modules/maintenanceFlow.ts`（状态流转）、`src/modules/maintenanceStore.ts`（本地持久化）。
