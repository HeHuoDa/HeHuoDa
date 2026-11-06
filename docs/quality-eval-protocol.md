# 官方通知独立质量集标注协议（#179）

本文件是 #179「独立真实公开质量集」的稳定执行口径，供后续执行者仅凭仓库与 Issue 开工使用。分类规则的产品语义见 [sicau-connectors.md](sicau-connectors.md)，领域词汇见根目录 `GLOSSARY.md`，验收配额与产品分类分离的决策见 [ADR 0009](adr/0009-competition-ness-vs-acceptance-quota.md)。

本地 `.data/` 下的历史报告、抓取样本、临时校验脚本与合成回归样例**只作本机备忘**，不是执行必要前提，也不进 Git。**本文件是完整契约**：引用本文件的 Issue 须链接可访问的准确版本（含 commit SHA）；票内契约摘要仅供阅读，不能替代本文件，执行者不得凭摘要猜测字段或枚举。

## 1. 验收口径

依据 #179 正文第 4、5 条及 2026-11-05 修订记录：

| 项           | 要求                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 样本总量     | ≥100 条不同官方通知，URL 规范化后去重                                                                                            |
| 五类有效正例 | 学科竞赛、创新创业、职业规划／技能、艺术文化、体育各至少一个                                                                     |
| 非赛事对照   | ≥20 条                                                                                                                           |
| 学院覆盖     | 按实际可核验的最大数量如实报告，**不设 27 院硬性下限**；缺哪个院、缺几条写真实数量，不凑数                                       |
| 延期／变更   | **不设下限，仅如实报告实际数量**（该类通知在真实站点本就稀缺），实际为 0 也要写明                                                |
| 字段正确性   | #179 第 5 条：报名／变更正例不被丢弃；自动字段无证据或错误确定资格／时间的未解决缺陷为 0；报告误收、误判明确、人工修正和疑似数量 |

数量不足记「未满足」并报告缺口，不能生成文本冒充真实抽样，不能用抽样结论外推全站准确率或漏收率。冻结答案不因发现缺陷而回改。

## 2. 域模型：三字段分离（ADR 0009）

一条通知「是否属于赛事」与「是否计入某次验收的样本配额」是两件事，必须由独立字段表达：

| 字段             | 回答的问题                 | 取值                                                            |
| ---------------- | -------------------------- | --------------------------------------------------------------- |
| `classification` | 内容性质是否为赛事         | `definite` / `suspected` / `non_competition`                    |
| `audience`       | 通知明示的适用对象         | `undergraduate` / `graduate-only` / `all` / `unknown` / `staff` |
| `quotaIncluded`  | 是否计入本次本科生正例配额 | `true` / `false`                                                |

只面向研究生的赛事仍是赛事，只在 `quotaIncluded` 记为 `false`，不得改成 `non_competition`。未区分本研视为包含本科生，不从发布学院、专业或站点反推适用人群。研究生奖学金、招聘等通知本来就可以是非赛事；`graduate-only + non_competition` 只是**待人工复核的提示**，不能仅凭人群与分类组合认定标注污染。

## 3. 标注字段契约

### 3.1 样本与顶层元数据（最小结构）

每条样本含 `sample_id`、`source`（含 `college_id`、`source_id`、`official_notice_url`、`canonical_notice_url`、`observed_at`、`published_at`）、`title`、`paragraphs`、`evidence_sha256`、`evidence_path`、`gold`、`annotation`。

顶层文档必填字段：

| 字段               | 类型           | 必填条件                                                                    |
| ------------------ | -------------- | --------------------------------------------------------------------------- |
| `schema_version`   | number         | 恒为 `2`                                                                    |
| `protocolVersion`  | string         | 恒为 `"v2"`                                                                 |
| `dataset`          | string         | 必填，数据集标识                                                            |
| `frozen`           | boolean        | 必填；pre-freeze 为 `false`，post-freeze 为 `true`                          |
| `frozenAt`         | string \| null | ISO 8601；`frozen=true` 时必填，否则 `null`                                 |
| `frozenBy`         | string \| null | `frozen=true` 时必填，否则 `null`                                           |
| `classifierNotRun` | boolean        | 必填，标注阶段不得调用分类器                                                |
| `boundCommit`      | string \| null | 评估前必填，绑定规则的准确提交                                              |
| `boundRuleVersion` | string \| null | 评估前必填                                                                  |
| `editionPolicy`    | object         | 必填，固定当届判断口径，见 3.2                                              |
| `totals`           | object         | 必填，`{samples: number, sources: number}`，且 `samples === samples.length` |
| `quotaRecord`      | object         | 必填，键见下                                                                |
| `annotation_meta`  | object         | 必填，键见下                                                                |
| `samples`          | array          | 必填，每条样本结构见本节开头                                                |

`editionPolicy` 结构：`{ asOfDate: "YYYY-MM-DD", timezone: "Asia/Shanghai", rules: string[] }`。`asOfDate` 与 `timezone` 固定当届判断日期与时区，**由数据集元数据一次性确定，票 A 标注与票 B 冻结都读同一份，不得随执行日期滚动**；`asOfDate` 在生成数据集时填入真实日期，示例中的 `YYYY-MM-DD` 仅为占位。

`quotaRecord` 全部键必填，布尔值必须由样本重算而非手工填写：`policy`(string)、`totalAtLeast100`(boolean)、`collegesReported`(number，按实际可核验数量)、`collegesHardFloor`(`false`)、`categoriesPresent`(string[])、`categoriesQuotaMet`(boolean)、`changeNotices`(number)、`changeHardFloor`(`false`)、`nonCompetitionControls`(number)、`nonCompetitionQuotaMet`(boolean)、`gaps`(string[])。

`annotation_meta` 全部键必填：`mode`(string)、`dualBlind`(`false`)、`classifierConsultedDuringLabeling`(boolean)。

最小完整文档示例（`samples` 为空数组示意）：

```json
{
  "schema_version": 2,
  "protocolVersion": "v2",
  "dataset": "issue179-independent-validation-v2",
  "frozen": false,
  "frozenAt": null,
  "frozenBy": null,
  "classifierNotRun": true,
  "boundCommit": null,
  "boundRuleVersion": null,
  "editionPolicy": {
    "asOfDate": "YYYY-MM-DD",
    "timezone": "Asia/Shanghai",
    "rules": [
      "按固定日期判断当届，不随执行日期滚动",
      "报名已截止但比赛未结束仍可计入",
      "仅获奖、公示、名单或回顾不计正例",
      "无法确定赛程结束或届次记 null"
    ]
  },
  "totals": { "samples": 0, "sources": 0 },
  "quotaRecord": {
    "policy": "#179 现行口径",
    "totalAtLeast100": false,
    "collegesReported": 0,
    "collegesHardFloor": false,
    "categoriesPresent": [],
    "categoriesQuotaMet": false,
    "changeNotices": 0,
    "changeHardFloor": false,
    "nonCompetitionControls": 0,
    "nonCompetitionQuotaMet": false,
    "gaps": []
  },
  "annotation_meta": {
    "mode": "ai-first-pass-then-user-confirms",
    "dualBlind": false,
    "classifierConsultedDuringLabeling": false
  },
  "samples": []
}
```

用途清单（dataset roles）最小结构，用于判定 `eligibleForIndependentAcceptance` 与 dev 零重叠（见第 5、7 节）：

```json
{
  "generatedAt": "2026-11-05T00:00:00Z",
  "schemaVersion": 1,
  "policy": "用途清单不回写标签；冻结不等于独立验证",
  "overlapCount": 0,
  "datasets": [
    {
      "path": "annotation/labels.frozen.json",
      "role": "dev",
      "sha256": "<64 位十六进制>",
      "count": 196,
      "frozen": true,
      "eligibleForIndependentAcceptance": false,
      "reason": "已用于发现和修复分类缺陷",
      "members": [
        { "id": "sampleId", "url": "https://example.edu/notice/1.htm" }
      ]
    }
  ],
  "reviewAttestation": {
    "dataset": "validation-diagnostic",
    "count": 69,
    "confirmedOn": "2026-11-05",
    "confirmedBy": "user",
    "originalConfirmationLocated": false,
    "labelsRewritten": false
  }
}
```

必填条件：`datasets` 数组非空；每项含 `path` / `role` / `sha256`（64 位 hex）/ `count` / `frozen` / `eligibleForIndependentAcceptance` / `reason` / `members`；`members` 每项含 `id` 与 `url`；`overlapCount` 为 dev 与验证集 URL 重叠数。用途清单缺失、无法解析或结构不完整时，独立性校验必须阻止放行。

### 3.2 `gold` 必填字段

`classification`、`audience`、`quotaIncluded`、`notification_kind`、`event_category`、`current_edition_positive`、`is_change_notice`、`fields`。

- `classification`：`definite` / `suspected` / `non_competition`，只描述内容性质，不承载适用人群或配额。
- `audience`：`undergraduate` / `graduate-only` / `all` / `unknown` / `staff`；只按通知明示表述，未区分本研视为包含本科生，不从学院或站点反推。
- `quotaIncluded`：`true` / `false`，表达是否计入本次本科生正例配额。
- `notification_kind`：`registration` / `supplement` / `award` / `news` / `other`。
- `event_category`：中文五类 `学科竞赛` / `创新创业` / `职业规划技能` / `艺术文化` / `体育` / `其他`；非赛事通知填 `null`。
- `current_edition_positive`：`true` / `false` / `null`。判定必须依据顶层 `editionPolicy`（3.1）固定的 `asOfDate` 与 `timezone`，**不得随票 A 标注或票 B 冻结的执行日期滚动**；`null` 表示无法确认当届，**不计入正例配额**，不迫使标注者猜测，字段本身仍须存在。规则：有官方证据表明在该固定日期仍在进行或即将举行才计当届；**报名已截止但比赛未结束可以计入**；仅有获奖、公示、名单或回顾不计正例；历史比赛可作其他对照，但不从发布日期年份推断当届；无法确定赛程结束或届次记 `null`。新采集形成的新版本不倒推为该日期已经公开的内容。
- `is_change_notice`：`true` / `false`。
- `quotaIncluded === true` 的当届正例才计入五类与学院配额统计。

### 3.3 自动字段（15 个键、四种状态与值结构）

`fields` 覆盖且仅覆盖以下 15 个键，每个键都是同一结构 `{state, value, evidence}`。四种 `state` 的 `value` / `evidence` 结构分别如下（时间字段的 `state=supported` 值结构见 3.4）：

| `state`          | `value`                                                                                                                                               | `evidence`                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `supported`      | 按下表对应类型；时间字段为 `{value, precision}` 对象                                                                                                  | `{paragraph: 整数, quote: 绑定文件对应段落中的原文片段}`，两值必填且非空                                |
| `unknown`        | `null`                                                                                                                                                | `{paragraph: null, quote: null}`；未知原因可记在 `annotation.reason`                                    |
| `conflict`       | `{ "candidates": [ { "value": <该字段 supported 时的类型>, "scope": "适用对象或赛段等限定", "evidence": {paragraph, quote} } ], "resolution": null }` | `{paragraph: null, quote: null}`，各候选自带 evidence；`resolution` 恒为 `null`，不自动选值、不取更晚值 |
| `not_applicable` | `null`                                                                                                                                                | `{paragraph: null, quote: null}`                                                                        |

时间字段冲突示例（**两组本科生各有互不覆盖的截止时间，且通知中不存在面向全体参赛者的统一截止**时才记 `conflict`；若存在面向全体参赛者的截止，按 3.4 取该条、多条并存时取最早，不记冲突；本科生／研究生两套截止按 3.4 只取本科生那条，也不记冲突）：

```json
{
  "state": "conflict",
  "value": {
    "candidates": [
      {
        "value": { "value": "2026-11-01", "precision": "date" },
        "scope": "本科生·第一批次（学院A—F）",
        "evidence": { "paragraph": 2, "quote": "学院A—F本科生报名截止11月1日" }
      },
      {
        "value": { "value": "2026-11-08", "precision": "date" },
        "scope": "本科生·第二批次（学院G—M）",
        "evidence": { "paragraph": 3, "quote": "学院G—M本科生报名截止11月8日" }
      }
    ],
    "resolution": null
  },
  "evidence": { "paragraph": null, "quote": null }
}
```

上例两条截止分别只覆盖部分本科生，没有任何一条面向全体参赛者，因此不存在「最早面向全体参赛者的报名截止」可供选取；此时不自行挑值、不取更晚值，按 `conflict` 保留双方候选与各自原文依据。

`supported` 时 `value` 不得为空；未确定项填 `unknown` 且 `value=null`，不留空缺、不猜测。15 个键在 `state=supported` 时的 `value` 类型：

| 键            | `state=supported` 时 `value` 的结构                                     |
| ------------- | ----------------------------------------------------------------------- |
| `name`        | 字符串：比赛名称（比较时做 NFKC 归一、去空白与标点）                    |
| `edition`     | 字符串：届次名称或年份标识                                              |
| `kind`        | 字符串：赛事种类／项目类型                                              |
| `organizer`   | 字符串：主办单位                                                        |
| `hosts`       | 字符串数组：承办单位列表                                                |
| `scope`       | 对象 `{ "kind": "all                                                    | specified | other               | unknown", "colleges": ["学院ID"] }`；含否定或排除语义时保留复杂原文，不把禁入学院列为允许范围 |
| `mode`        | 字符串：参赛形式（个人／团队等）                                        |
| `tracks`      | 字符串数组：赛道                                                        |
| `members`     | 字符串或数字：人数要求，按原文表述记录                                  |
| `rules`       | 字符串数组：规则条目                                                    |
| `stageNames`  | 字符串数组：赛段名称                                                    |
| `startsAt`    | 对象 `{ "value": "YYYY-MM-DD" 或 ISO 时刻或 null, "precision": "instant | date      | unknown" }`，见 3.4 |
| `deadline`    | 同上；只取本科生适用口径的报名截止，见 3.4                              |
| `materialsAt` | 同上；材料提交截止，不混进 `deadline`                                   |
| `eventAt`     | 同上；比赛／赛段时间                                                    |

`scope`、`hosts`、`tracks`、`rules`、`stageNames` 等数组或对象字段比较时按键排序后逐值比对；时间字段按 `value.value` 与 `value.precision` 分别比对。字段证据须绑定通知版本与附件版本；HTML 段落从 0 起，标题／元数据为 -1，PDF 页与 DOCX 段落从 1 起。

### 3.4 时间字段格式与本科生截止时间口径

`startsAt` / `deadline` / `materialsAt` / `eventAt` 在 **`state=supported`** 时 `value` 必须是对象，不设顶层 `precision`；其他 `state` 按 3.3 的结构填 `null` 或候选列表。

```json
{
  "state": "supported",
  "value": { "value": "2026-11-01", "precision": "date" },
  "evidence": { "paragraph": 0, "quote": "报名截止：2026年11月1日。" }
}
```

`precision` 取 `instant` / `date` / `unknown`。评估器按 `value.value` 与 `value.precision` 比较；扁平写法（`value` 直接是字符串）在 `supported` 时被明确拒绝，不再静默判为值不一致。仅注明截止日期不代表当天仍有名额；报名、材料提交与比赛时间分别记录；区间取终点（区间起止另存证据，主字段记最晚还能报名的时间）。

**本科生截止时间口径（自 protocol v2 A2，优先于「面向全体」的泛称）**：`deadline` 的 gold 只取本科生适用范围。

- 正文同时出现本科生与研究生两套截止时，**只取本科生那条**；研究生截止不作为 gold，也不因两套并存记 `conflict`。
- 正文只有研究生口径、无本科生适用口径时，`deadline` 记 `state=unknown`、`value=null`，并在 `annotation.reason` 或证据说明中注明「无本科生适用口径」；**不算系统缺陷、不计入正确**（按未知如实报告，不进正确计数，也不据此判定分类器错误）。
- 分群体、分阶段的多重截止全部保留到证据或 `fieldConflicts`；主字段取最早面向全体参赛者的报名截止；确实不存在统一全体截止时记 `conflict`（结构见 3.3），不自行挑值、不取更晚值。
- `audience` 按 3.2 判定，不从学院或站点反推；`quotaIncluded` 只表达配额，不改变上述取值口径。

### 3.5 `annotation` 与复核状态

每条含 `annotator`、`annotated_at`、`exposure`、`dual_blind`、`review_status`、`reason`。`review_status` 取 `pending` / `in-review` / `completed`；`dual_blind` 固定为 `false`（单人复核、非双盲）；`reason` 记录判断依据。**只有 `annotator=user` 且 `review_status=completed` 才算完成逐条复核**；停在 `AI-draft` 或 `pending` 不得冻结。

`exposure` 取 `blind` / `classifier-not-consulted-during-labeling` / `predictions-exposed`。标注阶段不得读取任何 predictions 文件、不得调用分类器；若已查看，须如实改为 `predictions-exposed`。

### 3.6 证据绑定与正文一致性

`evidence_sha256` 为 64 位十六进制；`evidence_path` 由模板生成器写成**相对标注文件**的路径，指向该样本的原始证据文件；校验器按标注文件所在目录解析并重算哈希，结果必须与 `evidence_sha256` 一致。

**绑定文件是唯一正文来源**：标注文件里的 `title`、`paragraphs`、`sample_id` 与 `source`（至少 `official_notice_url`、`college_id`）必须逐项与该证据文件一致，或直接由该文件生成。校验时必须重新读取绑定文件逐项比对：

- 段落数组长度、每个段落的 `index` 与 `text` 完全一致，不允许改写、增删、重排；
- `title`、`sample_id`、`source.official_notice_url`、`source.college_id` 一致；
- `supported` 字段的 `evidence.quote` 必须出现在**绑定文件**中 `evidence.paragraph` 指定段落的文本里，而不是只存在于标注文件的副本中；
- 任何一项不一致即判定证据绑定失败。

仅保留原文件与哈希、替换标注正文不能满足上述比对。**缺 `evidence_path`、哈希不一致，或正文／样本身份不一致时，不能判定 B2 原文依据已通过。**

## 4. B2 四条冻结准入

1. **字段齐全**：3.2 与 3.3 的所有字段均存在，按四种 `state` 的结构填写，未确定项填 `unknown`，枚举与取值合法；`totals`／`quotaRecord`／`annotation_meta`／`editionPolicy` 按 3.1 的最小结构齐备。
2. **原文依据**：每个 `supported` 字段有段落定位与原文引文，且证据绑定按 3.6 可复核——哈希匹配、**从绑定文件核对正文与样本身份**、引文出现在绑定文件对应段落。
3. **用户逐条复核**：每条复核完成、复核人与暴露状态如实记录；单人复核、非双盲。
4. **配额如实记录**：`quotaRecord` 必须与从样本重算的结果一致（总量、五类、非赛事、学院覆盖实际数、变更实际数），不能手工把布尔值填成 `true`。

**冻结前准入检查**（`freeze-check.mjs --mode=pre-freeze`）还须通过：URL 去重、与 dev 用途清单零重叠、用途清单可读且结构完整（读取失败即阻止）、三字段分离、转载关系逐对核对、配额从样本重算。此阶段文件应为 `frozen=false`，**不要求** `frozenAt`/`frozenBy`；把冻结元数据当作准入前提会造成循环。

## 5. 冻结与评估顺序

1. 采集与标注阶段不运行分类器、不读预测；模板生成器写入相对 `evidence_path` 与证据哈希，并从绑定文件读取 `title`／`paragraphs`／样本身份。
2. 完成用户逐条复核后，跑 `freeze-check.mjs --mode=pre-freeze` 做**冻结前准入检查**（B2 四条、独立性、配额重算）。此时文件为 `frozen=false`，不要求冻结元数据。
3. 准入通过后写入 `frozen=true`、`frozenAt`、`frozenBy`；再跑 `freeze-check.mjs --mode=post-freeze` 做**冻结文件完整性检查**（含冻结元数据）。两次都通过才算冻结完成。
4. 评估前把 `boundCommit` / `boundRuleVersion` 指向所用规则的**准确提交与规则版本**；同一规则版本内实现也可能变动，不能仅凭版本号断言与历史评估一致或不一致。
5. 冻结之后才对最终规则评估；分类指标与字段级指标分别报告。发现缺陷先写红测试、只在 dev 集复跑，验证集不调参，不回改冻结答案。
6. `frozen` 只表示答案固定，**不等于可作验收证据**；是否可作验收证据由数据集用途清单（结构见 3.1）的 `eligibleForIndependentAcceptance` 与 B2 四条共同判定。

## 6. 评估器契约

评估器读取 `gold.classification`、`gold.event_category`（中文，按下表映射后与旧英文格式统一）、`gold.current_edition_positive`（旧格式回退 `selection.current_edition_positive`）、`gold.is_change_notice`（旧格式回退 `selection.is_change_notice`）、`gold.quotaIncluded`（旧格式无此字段时按 `classification` 回退）。

| 中文                          | 评估器内部键 |
| ----------------------------- | ------------ |
| 学科竞赛                      | `discipline` |
| 创新创业                      | `innovation` |
| 职业规划技能 / 职业规划／技能 | `career`     |
| 艺术文化                      | `arts`       |
| 体育                          | `sports`     |

`--quota-only` 只输出配额重算，不能代替字段级评估；正式评估必须跑完整流程并检查字段级混淆、报名／变更漏判与字段误差。

## 7. 标注方式与独立性

标注方式为 **AI 草稿 + 用户逐条复核，单人复核、非双人独立盲标**，如实记录 `annotator` 与 `exposure`，不宣称双标一致性。不设第二位标注人或仲裁人。

独立集须与开发语料分开：URL 规范化去重、与 dev 用途清单零重叠、同标题条目逐对核对是否为多院转载同一通知（URL 不同不等于通知独立）。用途清单不可读、结构不完整或读取失败时不得放行。

## 8. 产物边界

现行文档、ADR 与词汇表按常规提交；历史评估报告、抓取样本、临时校验脚本、合成回归样例与机器可读结果只留在 Git 忽略的本地目录，不提交，也不作为 Issue 执行的必要前提。验收结论须区分本地检查、模拟、真实服务与生产状态，不能用构建通过或本地样例代替业务验收。

## 9. 相关文档

- `GLOSSARY.md`：赛事性质与配额口径、参赛人群口径、正文旁证、通知分类等词汇。
- `docs/adr/0004-official-notice-ingestion.md`：候选与正式比赛分离。
- `docs/adr/0009-competition-ness-vs-acceptance-quota.md`：验收口径不灌入产品分类。
- `docs/sicau-connectors.md`：分类规则版本与判定语义。
- `docs/agents/issue-tracker.md`：Issue 可开工标准与发布前审阅规则。
