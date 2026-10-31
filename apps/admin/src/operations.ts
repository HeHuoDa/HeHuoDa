import type { InjectionKey } from "vue";
import type { AdminHttp, Schema } from "./http";

const path = (kind: string, id: string) =>
  `/ingestion/${kind}/${encodeURIComponent(id)}`;
export function createOperationsService(http: Pick<AdminHttp, "request">) {
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
      http.request<Schema["IngestionAcceptedDto"]>(
        path("attachments", id) + "/recheck",
        { method: "POST", body },
      ),
    reparse: (id: string, body: Schema["AttachmentReparseCommandDto"]) =>
      http.request<Schema["IngestionAcceptedDto"]>(
        path("attachments", id) + "/reparse",
        { method: "POST", body },
      ),
    request: (id: string) =>
      http.request<Schema["IngestionRequestDto"]>(path("requests", id)),
    recover: (id: string) =>
      http.request<Schema["IngestionRequestDto"]>(
        "/ingestion/requests/by-operation/" + encodeURIComponent(id),
      ),
  };
}
export type OperationsService = ReturnType<typeof createOperationsService>;
export const operationsKey: InjectionKey<OperationsService> = Symbol(
  "ingestion-operations",
);
