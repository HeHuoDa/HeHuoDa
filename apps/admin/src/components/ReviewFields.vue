<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { College } from "@hehuoda/api-types";
import type { ReviewMaterial } from "../console/review";
import ReviewTime from "./ReviewTime.vue";
defineProps<{ colleges: College[]; disabled: boolean }>();
const model = defineModel<ReviewMaterial>({ required: true });
const patch = computed(() => model.value.batch.competitions[0]!);
const newTrackMode = ref<"" | "individual" | "team" | "mixed">("");
watch(
  () => model.value.checkedAt,
  (value) => {
    for (const notice of patch.value.notices)
      if (notice.url === model.value.source.url)
        notice.checkedAt = value || null;
  },
);
function addStage() {
  patch.value.stages.push({
    id: "",
    name: "",
    organizer: "",
    hosts: [],
    scope: { kind: "unknown", colleges: [], note: "" },
    startsAt: { precision: "unknown", value: null },
    deadline: { precision: "unknown", value: null },
    materialsAt: { precision: "unknown", value: null },
    eventAt: { precision: "unknown", value: null },
    timeNote: "",
    conflict: false,
    registration: "",
    order: patch.value.stages.length,
    sourceIds: patch.value.notices.map((n) => n.id),
  });
}
function addTrack() {
  if (newTrackMode.value)
    patch.value.tracks.push({
      id: "",
      name: "",
      mode: newTrackMode.value,
      members: "",
      rules: "",
    });
}
</script>
<template>
  <fieldset class="review-form" :disabled="disabled">
    <legend>人工修正资料</legend>
    <p class="field-help">
      核对日期由人工填写。未知字段保持空白或未知；发布单位不推导承办关系。来源、原文及版本基线均不在此表单修改。
    </p>
    <div class="review-fields">
      <label
        >比赛名称<input
          id="review-name"
          v-model="patch.name"
          maxlength="10000" /></label
      ><label>届次<input v-model="patch.edition" aria-label="届次" /></label
      ><label
        >比赛类别<input v-model="patch.category" aria-label="比赛类别" /></label
      ><label
        >组织单位<input
          v-model="patch.organizer"
          aria-label="组织单位"
          placeholder="未知则留空"
      /></label>
      <label
        >人工核对日期<input
          id="review-checkedAt"
          v-model="model.checkedAt"
          type="date" /></label
      ><label class="wide-field"
        >核对理由（必填）<textarea
          id="review-resolution"
          v-model="model.resolution"
          rows="4"
          maxlength="2000"
          placeholder="说明缺失、冲突、附件核对及判断依据"
        />
      </label>
    </div>
    <section
      v-for="(stage, index) in patch.stages"
      :id="'review-stage-' + stage.id"
      :key="index"
      class="stage-editor"
    >
      <h3>赛段 {{ index + 1 }}</h3>
      <div class="review-fields">
        <label
          >赛段 ID<input
            v-model="stage.id"
            :aria-label="'赛段' + (index + 1) + ' ID'" /></label
        ><label
          >赛段名称<input
            v-model="stage.name"
            :aria-label="'赛段' + (index + 1) + '名称'" /></label
        ><label
          >赛段组织单位<input
            v-model="stage.organizer"
            placeholder="未知则留空" /></label
        ><label
          >承办学院<ElSelect
            v-model="stage.hosts"
            multiple
            aria-label="承办学院"
            :disabled="disabled"
            ><ElOption
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id" /></ElSelect
        ></label>
        <label
          >参赛范围<ElSelect
            v-model="stage.scope.kind"
            aria-label="参赛范围"
            :disabled="disabled"
            @change="stage.scope.colleges = []"
            ><ElOption label="未知" value="unknown" /><ElOption
              label="全校"
              value="all" /><ElOption
              label="指定学院"
              value="colleges" /><ElOption
              label="复杂规则"
              value="complex" /></ElSelect></label
        ><label v-if="stage.scope.kind === 'colleges'"
          >允许参赛学院<ElSelect
            v-model="stage.scope.colleges"
            multiple
            aria-label="允许参赛学院"
            :disabled="disabled"
            ><ElOption
              v-for="college in colleges"
              :key="college.id"
              :label="college.name"
              :value="college.id" /></ElSelect></label
        ><label
          >参赛范围说明<input
            v-model="stage.scope.note"
            aria-label="参赛范围说明"
        /></label>
        <ReviewTime
          v-model="stage.startsAt"
          label="报名开始"
          :disabled="disabled"
        /><ReviewTime
          v-model="stage.deadline"
          label="报名截止"
          :disabled="disabled"
        /><ReviewTime
          v-model="stage.materialsAt"
          label="材料截止"
          :disabled="disabled"
        /><ReviewTime
          v-model="stage.eventAt"
          label="比赛时间"
          :disabled="disabled"
        />
        <label>时间说明<input v-model="stage.timeNote" /></label
        ><label>报名方式<input v-model="stage.registration" /></label
        ><label class="wide-field"
          >时间冲突待核对<input v-model="stage.conflict" type="checkbox"
        /></label>
      </div>
      <ElButton :disabled="disabled" @click="patch.stages.splice(index, 1)"
        >移除此赛段修正</ElButton
      >
    </section>
    <ElButton :disabled="disabled" @click="addStage">添加赛段修正</ElButton>
    <section class="stage-editor">
      <h3>正式来源通知修正</h3>
      <div
        v-for="notice in patch.notices"
        :key="notice.id"
        class="review-fields"
      >
        <label>正式通知标题<input v-model="notice.title" /></label
        ><label>正式发布单位<input v-model="notice.publisher" /></label
        ><label
          >通知发布日期<input v-model="notice.publishedAt" type="date" /></label
        ><label
          >通知类型<ElSelect
            v-model="notice.kind"
            :disabled="disabled"
            aria-label="通知类型"
            ><ElOption label="报名通知" value="registration" /><ElOption
              label="补充通知"
              value="supplement" /><ElOption
              label="获奖公示"
              value="award" /><ElOption
              label="新闻回顾"
              value="news" /></ElSelect
        ></label>
        <p class="field-help wide-field">
          来源链接（保留）：{{ notice.url }}<br />人工核对日期：{{
            notice.checkedAt || "待人工填写"
          }}
        </p>
      </div>
    </section>
    <section id="review-tracks" class="stage-editor" tabindex="-1">
      <h3>赛道与人数规则</h3>
      <div
        v-for="(track, index) in patch.tracks"
        :key="index"
        class="review-fields"
      >
        <label>赛道 ID<input v-model="track.id" /></label
        ><label>赛道名称<input v-model="track.name" /></label
        ><label
          >参赛方式<ElSelect
            v-model="track.mode"
            :disabled="disabled"
            aria-label="赛道参赛方式"
            ><ElOption label="个人" value="individual" /><ElOption
              label="团队"
              value="team" /><ElOption
              label="混合"
              value="mixed" /></ElSelect></label
        ><label>人数要求<input v-model="track.members" /></label
        ><label class="wide-field"
          >赛道规则<textarea v-model="track.rules" rows="3" /></label
        ><ElButton :disabled="disabled" @click="patch.tracks.splice(index, 1)"
          >移除此赛道修正</ElButton
        >
      </div>
      <div class="console-actions">
        <ElSelect
          v-model="newTrackMode"
          placeholder="先选择参赛方式"
          aria-label="新增赛道参赛方式"
          :disabled="disabled"
          ><ElOption label="个人" value="individual" /><ElOption
            label="团队"
            value="team" /><ElOption label="混合" value="mixed" /></ElSelect
        ><ElButton :disabled="disabled || !newTrackMode" @click="addTrack"
          >添加赛道修正</ElButton
        >
      </div>
    </section>
  </fieldset>
</template>
