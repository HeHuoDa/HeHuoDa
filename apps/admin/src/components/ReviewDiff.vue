<script setup lang="ts">
import { computed } from "vue";
import type { ReviewMaterial } from "../console/review";
const props = defineProps<{ file: ReviewMaterial }>();
const rows = computed(() => {
  const before = props.file.formalBefore;
  const after = props.file.batch.competitions[0]!;
  return [
    { field: "比赛名称", before: before?.name, after: after.name },
    { field: "届次", before: before?.edition, after: after.edition },
    { field: "组织单位", before: before?.organizer, after: after.organizer },
    { field: "类别", before: before?.category, after: after.category },
    {
      field: "平台发布状态",
      before: before?.publication,
      after: after.publication,
    },
    {
      field: "赛段 / 承办 / 范围 / 各类时间",
      before: before ? JSON.stringify(before.stages, null, 2) : undefined,
      after: JSON.stringify(after.stages, null, 2),
    },
    {
      field: "赛道 / 人数 / 规则",
      before: before ? JSON.stringify(before.tracks, null, 2) : undefined,
      after: JSON.stringify(after.tracks, null, 2),
    },
    {
      field: "正式来源通知 / 人工核对日期",
      before: before ? JSON.stringify(before.notices, null, 2) : undefined,
      after: JSON.stringify(after.notices, null, 2),
    },
  ];
});
</script>
<template>
  <section class="panel console-pad">
    <h2>正式比赛差异</h2>
    <p class="field-help">
      {{
        file.formalBefore?.publication === "published"
          ? "更新已发布比赛：必须审阅同一内容预览后再显式确认，不退回草稿。"
          : file.formalBefore
            ? "更新现有草稿，导入不等于发布。"
            : "新建草稿，导入不等于发布。"
      }}
    </p>
    <div class="diff-scroll" tabindex="0" aria-label="正式比赛差异表格">
      <table class="review-diff">
        <thead>
          <tr>
            <th>字段</th>
            <th>原正式内容</th>
            <th>本次修正材料</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.field"
            :class="{ changed: row.before !== row.after }"
          >
            <th>{{ row.field }}</th>
            <td>
              <pre>{{ row.before ?? "无（新建）" }}</pre>
            </td>
            <td>
              <pre>{{ row.after || "未知 / 留空" }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
