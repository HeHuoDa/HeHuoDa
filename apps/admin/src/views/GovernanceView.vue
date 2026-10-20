<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  governanceKey,
  governanceLabels,
  unavailableGovernance,
  exampleGovernance,
  type GovernanceKind,
  type GovernanceRecord,
  type ChangeRequest,
} from "../console/governance";
import { createResourceController, type PageQuery } from "../console/resource";
import { readQuery } from "../console/query";
import ResourceList from "../components/ResourceList.vue";
import ReasonDialog from "../components/ReasonDialog.vue";
const route = useRoute(),
  router = useRouter();
const kind = computed(() => route.meta.governance as GovernanceKind);
const config = computed(() => governanceLabels[kind.value]);
const example = computed(() => route.query.preview === "1");
const injected = inject(governanceKey, null);
const service = computed(
  () => injected ?? (example.value ? exampleGovernance : unavailableGovernance),
);
const query = computed(() => readQuery(route.query, config.value.states));
const controller = createResourceController<GovernanceRecord>();
const state = controller.state;
const accountLabels = { active: "正常业务账号", deactivated: "已注销业务账号" };
const businessLabels = {
  recruiting: "招募中",
  paused: "暂停招募",
  closed: "已关闭招募",
};
const rows = computed(() =>
  state.items.map((row) => ({
    ...row,
    secondary: row.accountStatus
      ? accountLabels[row.accountStatus]
      : row.businessStatus
        ? businessLabels[row.businessStatus]
        : row.conclusion,
  })),
);
const action = ref(""),
  dialog = ref(false);
let target: GovernanceRecord | null = null;
let operationId = "";
function load() {
  dialog.value = false;
  const id = route.params.id;
  if (id)
    return controller.select(() =>
      service.value.detail(kind.value, String(id)),
    );
  return controller.load(() => service.value.list(kind.value, query.value));
}
watch(() => route.fullPath, load, { immediate: true });
onUnmounted(controller.clear);
function updateQuery(value: PageQuery) {
  controller.clear();
  router.push({
    path: `/${kind.value}`,
    query: { ...value, preview: example.value ? "1" : undefined },
  });
}
function open(id: string) {
  router.push({
    path: `/${kind.value}/${encodeURIComponent(id)}`,
    query: route.query,
  });
}
function confirm(label: string) {
  if (!state.detail) return;
  target = structuredClone(state.detail);
  operationId = crypto.randomUUID();
  action.value = label;
  dialog.value = true;
}
async function execute(reason: string, conclusion: string) {
  if (!target) return;
  const request: ChangeRequest = {
    id: target.id,
    action: action.value,
    reason,
    version: target.version,
    baseline: target.baseline,
    operationId,
    ...(conclusion ? { conclusion } : {}),
  };
  await service.value.change(kind.value, request);
}
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>{{ config.title }}</h1>
      <p>查询与治理分别确认；操作不会自动改变其他业务状态。</p>
    </div>
    <RouterLink
      v-if="route.params.id"
      :to="{ path: '/' + kind, query: route.query }"
      class="inline-link"
      >返回列表</RouterLink
    >
  </div>
  <ElAlert
    :title="
      example
        ? '独立页面示例：以下不是实际用户、招募或举报，所有写服务均未开放。'
        : '管理服务未开放，不读取学生端会话示例作为真实管理数据。'
    "
    type="info"
    :closable="false"
  />
  <div class="example-toggle">
    <ElButton
      @click="
        router.push({
          path: '/' + kind,
          query: { preview: example ? undefined : '1' },
        })
      "
      >{{ example ? "退出示例" : "查看独立页面示例" }}</ElButton
    ><span>私人联系方式、密码和会话秘密不在管理视图内展示。</span>
  </div>
  <template v-if="route.params.id">
    <div
      v-if="state.detailStatus === 'loading'"
      class="panel empty-block"
      role="status"
    >
      正在加载详情…
    </div>
    <div v-else-if="state.detailStatus === 'error'" class="panel empty-block">
      <p role="alert">{{ state.detailError }}</p>
      <ElButton @click="load">重新加载详情</ElButton>
    </div>
    <section v-else-if="state.detail" class="panel console-pad">
      <span class="status-tag">独立页面示例</span>
      <h2 class="detail-heading">{{ state.detail.title }}</h2>
      <p class="detail-description">{{ state.detail.description }}</p>
      <dl class="console-details">
        <dt>对象 ID</dt>
        <dd>{{ state.detail.id }}</dd>
        <dt>版本 / 基线（只读）</dt>
        <dd>{{ state.detail.version }} / {{ state.detail.baseline }}</dd>
        <template v-if="kind === 'users'"
          ><dt>业务账号状态</dt>
          <dd>{{ accountLabels[state.detail.accountStatus!] }}</dd>
          <dt>限制状态</dt>
          <dd>
            {{ state.detail.restricted ? "已限制（示例既有状态）" : "未限制" }}
          </dd></template
        >
        <template v-else-if="kind === 'recruitments'"
          ><dt>招募业务状态</dt>
          <dd>{{ businessLabels[state.detail.businessStatus!] }}</dd>
          <dt>后台隐藏状态</dt>
          <dd>
            {{ state.detail.hidden ? "后台隐藏（示例既有状态）" : "未隐藏" }}
          </dd></template
        >
        <template v-else
          ><dt>处理状态</dt>
          <dd>
            {{
              config.states[state.detail.status as keyof typeof config.states]
            }}
          </dd>
          <dt>处理结论</dt>
          <dd>{{ state.detail.conclusion }}</dd>
          <dt>关联招募</dt>
          <dd>
            <RouterLink
              class="inline-link"
              :to="{
                path: '/recruitments/' + state.detail.targetId,
                query: { preview: example ? '1' : undefined },
              }"
              >{{ state.detail.targetId }}</RouterLink
            >
          </dd></template
        >
      </dl>
      <div class="console-actions">
        <ElButton
          v-if="kind === 'users'"
          @click="
            confirm(state.detail.restricted ? '恢复账号限制' : '限制账号')
          "
          >{{ state.detail.restricted ? "恢复账号限制" : "限制账号" }} ·
          确认预览</ElButton
        ><ElButton
          v-else-if="kind === 'recruitments'"
          @click="confirm(state.detail.hidden ? '恢复招募展示' : '隐藏招募')"
          >{{ state.detail.hidden ? "恢复招募展示" : "隐藏招募" }} ·
          确认预览</ElButton
        ><ElButton
          v-else
          :disabled="state.detail.status === 'resolved'"
          @click="confirm('处理举报')"
          >处理举报 · 确认预览</ElButton
        >
      </div>
    </section>
  </template>
  <ResourceList
    v-else
    :items="rows"
    :total="state.total"
    :status="state.status"
    :error="state.error"
    :query="query"
    :states="config.states"
    @query="updateQuery"
    @open="open"
    @retry="load"
  />
  <ReasonDialog
    v-model="dialog"
    :title="action"
    :needs-conclusion="kind === 'reports'"
    :execute="execute"
  />
</template>
