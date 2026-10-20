import type {
  CompetitionPatch,
  ImportPatch,
  ReviewInput,
  ReviewMaterial,
  StagePatch,
} from "./review";
const unknownTime = () => ({ precision: "unknown" as const, value: null });
function mergeItems<T extends { id: string }>(
  original: T[],
  patches: (Partial<T> & { id: string })[],
): T[] {
  const result = structuredClone(original);
  for (const patch of patches) {
    const index = result.findIndex((item) => item.id === patch.id);
    if (index < 0) result.push(patch as T);
    else result[index] = { ...result[index]!, ...patch };
  }
  return result;
}
export function toReviewDraft(input: ReviewInput): ReviewMaterial {
  const file = structuredClone(input);
  const competitions = file.batch.competitions.map((patch) => {
    const before =
      file.formalBefore?.id === patch.id ? file.formalBefore : null;
    const value: CompetitionPatch = Object.assign(
      {
        name: "",
        edition: "",
        category: "",
        organizer: "",
        origin: "official",
        publication: "draft",
        stages: [],
        tracks: [],
        notices: [],
      },
      before,
      patch,
    );
    const stagePatches = (patch.stages ?? []).map((stage) => ({
      ...stage,
      scope: {
        kind: "unknown" as const,
        colleges: [],
        note: "",
        ...before?.stages.find((item) => item.id === stage.id)?.scope,
        ...stage.scope,
      },
    }));
    value.stages = mergeItems(before?.stages ?? [], stagePatches).map(
      (stage): StagePatch =>
        Object.assign(
          {
            name: "",
            organizer: "",
            hosts: [],
            scope: { kind: "unknown", colleges: [], note: "" },
            startsAt: unknownTime(),
            deadline: unknownTime(),
            materialsAt: unknownTime(),
            eventAt: unknownTime(),
            timeNote: "",
            conflict: false,
            registration: "",
            order: 0,
            sourceIds: [],
          },
          stage,
        ),
    );
    value.tracks = mergeItems(before?.tracks ?? [], patch.tracks ?? []).map(
      (track) => Object.assign({ name: "", members: "", rules: "" }, track),
    );
    value.notices = mergeItems(before?.notices ?? [], patch.notices ?? []).map(
      (notice) =>
        Object.assign(
          {
            title: "",
            publisher: "",
            url: "",
            kind: "registration" as const,
            publishedAt: null,
            checkedAt: null,
          },
          notice,
        ),
    );
    return value;
  });
  return { ...file, batch: { competitions } };
}
// 不编辑的字段保留原局部补丁。原样材料必须能再次提交，不改变已批准文件形状。
export function serializeReviewDraft(
  draft: ReviewMaterial,
  original: ReviewInput,
): ReviewInput {
  const baseline = toReviewDraft(original),
    output = structuredClone(original);
  output.checkedAt = draft.checkedAt;
  output.resolution = draft.resolution;
  output.batch.competitions = draft.batch.competitions.map((patch, index) => {
    const value: ImportPatch = structuredClone(
      original.batch.competitions[index] ?? { id: patch.id },
    );
    for (const key of Object.keys(patch) as (keyof CompetitionPatch)[]) {
      if (
        JSON.stringify(patch[key]) !==
        JSON.stringify(baseline.batch.competitions[index]?.[key])
      )
        Object.assign(value, { [key]: structuredClone(patch[key]) });
    }
    return value;
  });
  return output;
}
