import type { InjectionKey } from "vue";
import type { AdminHttp, Schema } from "./http";
import { createControlService } from "./adapters";

const path = (kind: string, id: string) =>
  `/ingestion/${kind}/${encodeURIComponent(id)}`;
export function createOperationsService(
  http: Pick<AdminHttp, "request">,
  actor = () => "",
  owner = () => "",
) {
  const control = createControlService(http, actor, "attachments", owner);
  async function submitAttachment(
    id: string,
    operation: "recheck" | "reparse",
    body: Schema["AttachmentCommandDto"] & { versionId?: string },
  ) {
    const result = await control.attachment(id, operation, body);
    return { requestId: result.requestId, status: "accepted" };
  }
  const channel = (source: string, id: string) =>
    path("sources", source) + "/channels/" + encodeURIComponent(id);
  return {
    directory: () =>
      http.request<Schema["CollegeVerificationCandidateDto"][]>(
        "/ingestion/coverage-candidates",
      ),
    sources: () =>
      http.request<Schema["IngestionSourceDto"][]>("/ingestion/sources"),
    verify: (source: string, id: string, body: Schema["VerifyChannelDto"]) =>
      http.request(channel(source, id) + "/verification", {
        method: "PUT",
        body,
      }),
    configure: (
      source: string,
      id: string,
      body: Schema["ConfigureChannelDto"],
    ) => http.request(channel(source, id), { method: "PATCH", body }),
    attachments: (notice: string) =>
      http.request<Schema["NoticeAttachmentsDto"]>(
        path("notices", notice) + "/attachments",
      ),
    attachmentVersions: (id: string, page = 1) =>
      http.request<Schema["AttachmentVersionsDto"]>(
        path("attachments", id) + `/versions?page=${page}&pageSize=10`,
      ),
    attachmentText: (id: string, version: string, page = 1) =>
      http.request<Schema["AttachmentTextDto"]>(
        path("attachments", id) +
          `/versions/${encodeURIComponent(version)}?page=${page}&pageSize=10`,
      ),
    recheck: (id: string, body: Schema["AttachmentCommandDto"]) =>
      submitAttachment(id, "recheck", body),
    reparse: (id: string, body: Schema["AttachmentReparseCommandDto"]) =>
      submitAttachment(id, "reparse", body),
    request: (id: string) =>
      http.request<Schema["IngestionRequestDto"]>(path("requests", id)),
    pendingOperation: () => control.pendingOperation?.() ?? null,
    recoverPending: () => control.recoverPending!(),
  };
}
export type OperationsService = ReturnType<typeof createOperationsService>;
export const operationsKey: InjectionKey<OperationsService> = Symbol(
  "ingestion-operations",
);
