import type {
  Directory,
  ParsedCandidate as NoticeCandidate,
  TimeValue as NoticeTime,
} from "@hehuoda/sicau-connectors/notices";
import type {
  CollegeRecord,
  TimeValue,
} from "../competitions/competition.model.js";
import type { ParsedCandidate } from "./types.js";

export function noticeDirectory(colleges: CollegeRecord[]): Directory {
  return colleges.map(({ id, name }) => ({ id, name }));
}

const platformTime = ({ precision, value }: NoticeTime): TimeValue => ({
  precision,
  value,
});

export function platformCandidate(candidate: NoticeCandidate): ParsedCandidate {
  return {
    ...candidate,
    fields: {
      ...candidate.fields,
      startsAt: platformTime(candidate.fields.startsAt),
      deadline: platformTime(candidate.fields.deadline),
      materialsAt: platformTime(candidate.fields.materialsAt),
      eventAt: platformTime(candidate.fields.eventAt),
    },
  };
}
