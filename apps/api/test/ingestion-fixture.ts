import type { ImportCompetition } from "../src/competitions/import.js";
import type { ReviewFile } from "../src/ingestion/review.js";
import { edition } from "./competition-fixture.js";
export function correctedReview(
  file: ReviewFile,
  extra: Partial<ImportCompetition> = {},
): ReviewFile {
  const r = edition(file.targetId, {
    publication: file.formalBefore?.publication ?? "draft",
    ...extra,
  });
  const source = file.batch.competitions![0].notices![0];
  r.notices = [{ ...source, checkedAt: "2026-10-11" }];
  r.stages![0].sourceIds = [source.id];
  return {
    ...file,
    checkedAt: "2026-10-11",
    resolution:
      "已逐项核对正文、届次与赛段；未知项保留，附件未核实，不据附件推断资格。",
    batch: { competitions: [r] },
  };
}
