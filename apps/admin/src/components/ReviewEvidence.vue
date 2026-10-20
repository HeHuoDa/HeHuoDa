<script setup lang="ts">
import { computed } from "vue";
import { safeSourceUrl, type ReviewMaterial } from "../console/review";
const props = defineProps<{ file: ReviewMaterial }>();
const fields = computed(() => props.file.candidate.fields);
const times = [
  ["startsAt", "报名开始"],
  ["deadline", "报名截止"],
  ["materialsAt", "材料截止"],
  ["eventAt", "比赛时间"],
] as const;
</script>
<template>
  <section class="panel console-pad">
    <h2>来源与版本（只读）</h2>
    <dl class="console-details">
      <dt>发布单位</dt>
      <dd>{{ file.source.publisher }}</dd>
      <dt>承办学院</dt>
      <dd>{{ fields.hosts.join("、") || "未知，不能由发布单位推断" }}</dd>
      <dt>参赛范围</dt>
      <dd>{{ fields.scope.kind }} · {{ fields.scope.note || "尚无说明" }}</dd>
      <dt>来源版本 / 修订</dt>
      <dd>{{ file.sourceVersion }} / {{ file.candidateRevision }}</dd>
      <dt>正式基线</dt>
      <dd>{{ file.baseline }}</dd>
      <dt>采集时间</dt>
      <dd>{{ file.source.fetchedAt }}（不等于人工核对日期）</dd>
      <dt>适配器 / 来源健康</dt>
      <dd>{{ file.source.adapterVersion }} / {{ file.source.health }}</dd>
      <dt>原始 URL</dt>
      <dd>
        <a
          v-if="safeSourceUrl(file.source.url)"
          :href="safeSourceUrl(file.source.url)!"
          target="_blank"
          rel="noopener noreferrer"
          >{{ file.source.url }}</a
        ><span v-else>不安全链接已禁用</span>
      </dd>
      <dt>最终 URL</dt>
      <dd>{{ file.source.finalUrl }}</dd>
      <template v-for="[key, label] in times" :key="key"
        ><dt>{{ label }}</dt>
        <dd>
          {{ fields[key].precision === "unknown" ? "未知" : fields[key].value }}
          · {{ fields[key].precision }}
        </dd></template
      >
    </dl>
    <h3>提取字段（只读）</h3>
    <pre class="plain-document">{{ JSON.stringify(fields, null, 2) }}</pre>
    <div class="evidence-notes">
      <div>
        <h3>缺失字段</h3>
        <ul>
          <li v-for="item in file.candidate.missing" :key="item">{{ item }}</li>
        </ul>
      </div>
      <div>
        <h3>冲突</h3>
        <ul>
          <li v-for="item in file.candidate.conflicts" :key="item">
            {{ item }}
          </li>
        </ul>
      </div>
      <div>
        <h3>警告</h3>
        <ul>
          <li v-for="item in file.candidate.warnings" :key="item">
            {{ item }}
          </li>
        </ul>
      </div>
    </div>
    <h3>字段证据</h3>
    <blockquote
      v-for="(evidence, index) in file.candidate.evidence"
      :key="index"
      class="evidence-quote"
    >
      <strong
        >{{ evidence.field }} · 第{{ evidence.paragraph }}段 ·
        {{ evidence.sourceVersion || file.sourceVersion }}</strong
      >
      <p>{{ evidence.excerpt }}</p>
      <a
        v-if="safeSourceUrl(evidence.url)"
        :href="safeSourceUrl(evidence.url)!"
        target="_blank"
        rel="noopener noreferrer"
        >查看证据来源</a
      ><span v-else>证据链接不安全，已禁用</span>
    </blockquote>
  </section>
  <section class="panel console-pad">
    <h2>通知原文与旧版本（纯文本）</h2>
    <div class="document-columns">
      <div>
        <h3>{{ file.article.title }}</h3>
        <pre class="plain-document">{{ file.article.text }}</pre>
      </div>
      <div>
        <h3>旧版：{{ file.previousArticle?.title || "无旧版本" }}</h3>
        <pre class="plain-document">{{
          file.previousArticle?.text || "没有旧正文可比较。"
        }}</pre>
      </div>
    </div>
    <h3>附件链接（不下载、不解析）</h3>
    <ul>
      <li v-for="(attachment, index) in file.article.attachments" :key="index">
        <a
          v-if="safeSourceUrl(attachment.url)"
          :href="safeSourceUrl(attachment.url)!"
          target="_blank"
          rel="noopener noreferrer"
          >{{ attachment.title }}</a
        ><span v-else>{{ attachment.title }}（不安全链接已禁用）</span>
      </li>
    </ul>
  </section>
</template>
