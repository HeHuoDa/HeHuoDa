<script setup lang="ts">
import type { College } from "@hehuoda/api-types";
import type { CompetitionPatch } from "../console/review";
import ReviewTime from "./ReviewTime.vue";
defineProps<{ colleges: College[]; disabled: boolean; existing: boolean }>();
const model = defineModel<CompetitionPatch>({ required: true });
function addStage() {
  model.value.stages.push({
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
    order: model.value.stages.length,
    sourceIds: [],
  });
}
</script>
<template>
  <fieldset class="review-form" :disabled="disabled">
    <legend>届次基本资料</legend>
    <div class="review-fields">
      <label
        >ID<input
          id="competition-id"
          v-model="model.id"
          :disabled="existing"
          maxlength="100"
      /></label>
      <label
        >比赛名称<input
          id="competition-name"
          v-model="model.name"
          maxlength="10000"
      /></label>
      <label>届次<input v-model="model.edition" /></label
      ><label>类别<input v-model="model.category" /></label>
      <label
        >组织单位<input
          v-model="model.organizer"
          placeholder="未知留空，不从发布单位推导"
      /></label>
      <label
        >信息性质<select v-model="model.origin">
          <option value="official">官方来源</option>
          <option value="historical">历史信息</option>
          <option value="demo">演示资料</option>
        </select></label
      >
    </div>
    <p class="field-help">
      时间显示与录入以北京时间为基准；精确时刻输入时区（如
      +08:00）。日期不自动补齐
      23:59。发布单位、组织单位、承办学院与参赛范围分别维护。
    </p>
    <section id="competition-relations" tabindex="-1">
      <section
        v-for="(stage, index) in model.stages"
        :key="index"
        class="stage-editor"
      >
        <h3>赛段 {{ index + 1 }}</h3>
        <div class="review-fields">
          <label>赛段 ID<input v-model="stage.id" /></label
          ><label>赛段名称<input v-model="stage.name" /></label>
          <label>赛段组织单位<input v-model="stage.organizer" /></label
          ><label
            >排序<input v-model.number="stage.order" type="number" min="0"
          /></label>
          <label
            >承办学院<ElSelect
              v-model="stage.hosts"
              multiple
              :disabled="disabled"
              aria-label="承办学院"
              ><ElOption
                v-for="c in colleges"
                :key="c.id"
                :value="c.id"
                :label="c.name" /></ElSelect
          ></label>
          <label
            >参赛范围<select
              v-model="stage.scope.kind"
              @change="stage.scope.colleges = []"
            >
              <option value="unknown">未知</option>
              <option value="all">全校</option>
              <option value="colleges">指定学院</option>
              <option value="complex">复杂规则</option>
            </select></label
          >
          <label v-if="stage.scope.kind === 'colleges'"
            >允许参赛学院<ElSelect
              v-model="stage.scope.colleges"
              multiple
              :disabled="disabled"
              aria-label="允许参赛学院"
              ><ElOption
                v-for="c in colleges"
                :key="c.id"
                :value="c.id"
                :label="c.name" /></ElSelect
          ></label>
          <label>范围说明<textarea v-model="stage.scope.note" /></label>
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
          ><label>报名方式<input v-model="stage.registration" /></label>
          <label
            >关联本届来源<ElSelect
              v-model="stage.sourceIds"
              multiple
              :disabled="disabled"
              aria-label="关联本届来源"
              ><ElOption
                v-for="n in model.notices"
                :key="n.id"
                :value="n.id"
                :label="n.title || n.id" /></ElSelect
          ></label>
          <label
            >时间冲突待核对<input v-model="stage.conflict" type="checkbox"
          /></label>
        </div>
        <ElButton :disabled="disabled" @click="model.stages.splice(index, 1)"
          >移除赛段</ElButton
        >
      </section>
      <ElButton :disabled="disabled" @click="addStage">添加赛段</ElButton>
      <section class="stage-editor">
        <h3>赛道与人数规则</h3>
        <div
          v-for="(track, index) in model.tracks"
          :key="index"
          class="review-fields"
        >
          <label>赛道 ID<input v-model="track.id" /></label
          ><label>赛道名称<input v-model="track.name" /></label>
          <label
            >参赛方式<select v-model="track.mode">
              <option value="individual">个人</option>
              <option value="team">团队</option>
              <option value="mixed">混合</option>
            </select></label
          >
          <label>人数要求<input v-model="track.members" /></label
          ><label class="wide-field"
            >规则<textarea v-model="track.rules" />
          </label>
          <ElButton :disabled="disabled" @click="model.tracks.splice(index, 1)"
            >移除赛道</ElButton
          >
        </div>
        <ElButton
          :disabled="disabled"
          @click="
            model.tracks.push({
              id: '',
              name: '',
              mode: 'team',
              members: '',
              rules: '',
            })
          "
          >添加赛道</ElButton
        >
      </section>
      <section class="stage-editor">
        <h3>来源通知与核对日期</h3>
        <div
          v-for="(notice, index) in model.notices"
          :key="index"
          class="review-fields"
        >
          <label>通知 ID<input v-model="notice.id" /></label
          ><label>通知标题<input v-model="notice.title" /></label>
          <label>发布单位<input v-model="notice.publisher" /></label
          ><label>来源 URL<input v-model="notice.url" /></label>
          <label
            >类型<select v-model="notice.kind">
              <option value="registration">报名通知</option>
              <option value="supplement">补充通知</option>
              <option value="award">获奖公示</option>
              <option value="news">新闻回顾</option>
            </select></label
          >
          <label
            >发布日期<input
              type="date"
              :value="notice.publishedAt"
              @input="
                notice.publishedAt =
                  ($event.target as HTMLInputElement).value || null
              "
          /></label>
          <label
            >核对日期<input
              type="date"
              :value="notice.checkedAt"
              @input="
                notice.checkedAt =
                  ($event.target as HTMLInputElement).value || null
              "
          /></label>
          <ElButton :disabled="disabled" @click="model.notices.splice(index, 1)"
            >移除来源通知</ElButton
          >
        </div>
        <ElButton
          :disabled="disabled"
          @click="
            model.notices.push({
              id: '',
              title: '',
              publisher: '',
              url: '',
              kind: 'registration',
              publishedAt: null,
              checkedAt: null,
            })
          "
          >添加来源通知</ElButton
        >
      </section>
    </section>
    <p class="field-help">
      未改动关系不提交；修改关系数组表示完整替换，清空数组表示清空该关系。移除来源后请重新核对赛段引用；不提供硬删除届次、归档或学院字典编辑。
    </p>
  </fieldset>
</template>
