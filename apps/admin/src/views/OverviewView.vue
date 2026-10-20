<script setup lang="ts">
import { ref } from "vue";
import { CalendarDays, ClipboardCheck, ArrowRight, Sprout } from "@lucide/vue";
import OverviewStatus from "../components/OverviewStatus.vue";
const showExamples = ref(false);
const today = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
const examples = [
  {
    college: "信息工程学院",
    title: "大学生程序设计竞赛报名通知",
    date: "2026-10-19",
  },
  {
    college: "生命科学学院",
    title: "生命科学竞赛校内选拔补充说明",
    date: "2026-10-18",
  },
];
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="date-line"><CalendarDays :size="15" />{{ today }}</div>
      <h1>让每一条好机会，被看见。</h1>
      <p>从通知核对到比赛发布，在这里处理内容工作。</p>
    </div>
  </div>
  <OverviewStatus />
  <div class="example-toggle">
    <ElButton
      :aria-expanded="showExamples"
      aria-controls="overview-examples"
      @click="showExamples = !showExamples"
      >{{ showExamples ? "收起布局示例" : "查看布局示例" }}</ElButton
    >
    <span>示例数据与真实统计分开展示</span>
  </div>
  <div v-if="showExamples" id="overview-examples" class="overview-grid">
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>待办通知布局示例</h2>
          <p>以下为固定示例，不代表实际采集或待办。</p>
        </div>
      </div>
      <RouterLink
        v-for="item in examples"
        :key="item.title"
        to="/reviews"
        class="todo-row"
      >
        <span class="todo-icon"><ClipboardCheck :size="20" /></span>
        <div>
          <span class="small-label">{{ item.college }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.date }} · 示例通知</p>
        </div>
        <span class="status-tag pending">示例</span><ArrowRight :size="17" />
      </RouterLink>
      <div class="panel-footnote">
        来源内容需人工核对；审核和导入功能待接入。
      </div>
    </section>
    <section class="workflow-panel">
      <span class="workflow-icon"><Sprout /></span>
      <h2>把信息整理成机会</h2>
      <p>每一步都需要明确确认。</p>
      <ol class="workflow-list">
        <li>
          <b>1</b><span>采集通知<small>生成待审核候选</small></span>
        </li>
        <li>
          <b>2</b><span>人工核对<small>核对来源、时间和参赛范围</small></span>
        </li>
        <li>
          <b>3</b><span>导入草稿<small>完善比赛内容与规则</small></span>
        </li>
        <li>
          <b>4</b><span>确认发布<small>比赛才会面向学生展示</small></span>
        </li>
      </ol>
    </section>
  </div>
</template>
