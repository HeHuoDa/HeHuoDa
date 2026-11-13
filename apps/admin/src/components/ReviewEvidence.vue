<script setup lang="ts">
import { computed } from "vue";
import { safeSourceUrl, type ReviewInput } from "../console/review";
import {
  CANDIDATE_TIME_LABELS,
  candidateFieldRows,
  candidateFieldsV2,
  evidenceLabel,
  evidenceLocation,
  legacyFieldRows,
  notificationKindLabel,
  resolveNotificationKind,
  reviewHints,
  type EvidenceLike,
  type EvidenceLocation,
} from "../console/candidate-view";
const props = defineProps<{ file: ReviewInput; noticeId?: string }>();
/**
 * 只读展示取 v2 契约；旧材料没有 fieldsV2 时显式走 legacy 分支，
 * 并且不把旧投影的 kind／scope 当成赛事种类或候选四值。
 */
const fields = computed(() => candidateFieldsV2(props.file.candidate));
const legacy = computed(() => props.file.candidate.fields);
const rows = computed(() =>
  fields.value ? candidateFieldRows(fields.value) : [],
);
/** 旧材料同样要能看到已有的规则、赛道规则与时间，避免复核时字段被隐藏。 */
const legacyRows = computed(() =>
  fields.value ? [] : legacyFieldRows(legacy.value),
);
const hints = computed(() => reviewHints(props.file.candidate));
const times = CANDIDATE_TIME_LABELS;
type Located = {
  evidence: EvidenceLike;
  label: string;
  version: string;
  attachmentVersion: string | null;
  to: EvidenceLocation | null;
};
function located(evidence: EvidenceLike): Located {
  return {
    evidence,
    label: evidenceLabel(evidence),
    version:
      evidence.noticeVersion ??
      evidence.sourceVersion ??
      props.file.sourceVersion,
    attachmentVersion: evidence.attachmentVersion ?? null,
    to: evidenceLocation(props.noticeId, evidence, props.file.sourceVersion),
  };
}
const quotes = computed(() =>
  (props.file.candidate.evidence ?? []).map(located),
);
const references = computed(() =>
  (props.file.evidenceReferences ?? []).map(located),
);
const conflicts = computed(() =>
  (props.file.candidate.fieldConflicts ?? []).map((conflict) => ({
    field: conflict.field,
    values: conflict.values.map((choice) => ({
      value: choice.value,
      evidence: (choice.evidence ?? []).map(located),
    })),
  })),
);
</script>
<template>
  <section class="panel console-pad">
    <h2>来源与版本（只读）</h2>
    <dl class="console-details">
      <dt>发布单位</dt>
      <dd>{{ file.source.publisher }}</dd>
      <dt>通知种类</dt>
      <dd>
        {{ notificationKindLabel(resolveNotificationKind(file.candidate)) }}
        <span class="field-help"
          >（只取分类结果 notificationKind，不是赛事种类）</span
        >
      </dd>
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
    </dl>
    <h3>
      候选字段（只读，契约 {{ file.candidate.fieldsContract ?? "旧材料" }}）
    </h3>
    <template v-if="fields">
      <dl class="console-details">
        <template v-for="row in rows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>
            {{ row.value }}
            <span v-if="row.hint" class="field-help">{{ row.hint }}</span>
          </dd>
        </template>
      </dl>
      <p class="field-help">
        候选范围四值（all/specified/other/unknown）与正式比赛范围
        （all/colleges/complex/unknown）是不同枚举；导入映射由后端完成，界面不猜测。
      </p>
      <p class="field-help" role="status">
        #206
        阶段一：赛事种类、参赛形式、规则、赛段名称与四类时间本期不自动提取，赛道只提取名称；
        候选里对应取值为空是范围定义，不是正文缺信息或解析失败。原文与附件定位证据
        仍保留在上方，请据此在下方正式记录里人工填写。
      </p>
      <dl class="console-details">
        <template v-for="[key, label] in times" :key="key">
          <dt>{{ label }}</dt>
          <dd>
            {{
              fields[key].precision === "unknown" ? "未知" : fields[key].value
            }}
            · {{ fields[key].precision }}
          </dd>
        </template>
      </dl>
    </template>
    <p v-else class="field-help" role="status">
      旧版审核材料没有候选 v2 字段：赛事种类与参赛形式原文无法展示。
      通知种类仅按旧材料的 kind
      显示，不据此推断赛事种类；下列旧投影仍会随材料提交，
      复核时须逐项核对。如需完整字段请重新导出审核材料。
    </p>
    <dl v-if="legacyRows.length" class="console-details">
      <template v-for="row in legacyRows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>
          {{ row.value }}
          <span v-if="row.hint" class="field-help">{{ row.hint }}</span>
        </dd>
      </template>
    </dl>
    <div class="evidence-notes">
      <div
        v-for="group in ['conflict', 'missing', 'warning'] as const"
        :key="group"
      >
        <h3>
          {{
            group === "conflict"
              ? "冲突（须人工解决）"
              : group === "missing"
                ? "缺失字段"
                : "警告"
          }}
        </h3>
        <ul>
          <li
            v-for="hint in hints.filter((h) => h.kind === group)"
            :key="hint.text"
          >
            {{ hint.text }}
          </li>
        </ul>
        <p v-if="!hints.some((h) => h.kind === group)" class="field-help">无</p>
      </div>
    </div>
    <p v-if="hints.length" class="field-help" role="note">
      以上为提取与证据状态提示；引文形态可定位不等于「依据充分」，仍需人工核对原文。
    </p>
    <h3>字段证据</h3>
    <p v-if="file.candidate.classification">
      规则 {{ file.candidate.classification.ruleVersion }} ·
      {{ file.candidate.classification.classification }} ·
      {{ file.candidate.classification.reasons.join("；") }}
    </p>
    <details v-for="conflict in conflicts" :key="conflict.field">
      <summary>{{ conflict.field }} 的冲突候选值（须人工解决）</summary>
      <div v-for="(choice, index) in conflict.values" :key="index">
        <pre class="notice-text">{{
          JSON.stringify(choice.value, null, 2)
        }}</pre>
        <blockquote v-for="(item, i) in choice.evidence" :key="i">
          <p>{{ item.evidence.excerpt }}</p>
          <RouterLink v-if="item.to" :to="item.to"
            >定位此值的版本证据（{{ item.label }}）</RouterLink
          >
          <span v-else class="field-help">该证据未绑定可定位的版本</span>
        </blockquote>
      </div>
    </details>
    <blockquote
      v-for="(item, index) in quotes"
      :key="index"
      class="evidence-quote"
    >
      <strong
        >{{ item.evidence.field }} · {{ item.label }} · {{ item.version }}
        <span v-if="item.attachmentVersion" class="field-help"
          >· 附件版本 {{ item.attachmentVersion }}</span
        ></strong
      >
      <p>{{ item.evidence.excerpt }}</p>
      <RouterLink v-if="item.to" :to="item.to">定位平台版本证据</RouterLink>
      <span v-else class="field-help">未绑定附件版本，无法定位该段</span>
      <a
        v-if="safeSourceUrl(item.evidence.url)"
        :href="safeSourceUrl(item.evidence.url)!"
        target="_blank"
        rel="noopener noreferrer"
        >查看证据来源</a
      ><span v-else>证据链接不安全，已禁用</span>
    </blockquote>
    <details v-if="references.length">
      <summary>附件／正文证据引用（不可变版本）</summary>
      <blockquote v-for="(item, i) in references" :key="i">
        <strong
          >{{ item.evidence.field }} · {{ item.label }} ·
          {{ item.attachmentVersion ?? item.version }}</strong
        >
        <p>{{ item.evidence.excerpt }}</p>
        <RouterLink v-if="item.to" :to="item.to"
          >定位该版本 {{ item.label }}</RouterLink
        >
        <span v-else class="field-help">未绑定附件版本，无法定位该段</span>
      </blockquote>
    </details>
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
