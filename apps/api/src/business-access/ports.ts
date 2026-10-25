import type { AccessTransaction } from "../database/access-transaction.js";

export const sensitiveActions = [
  "publishRecruitment",
  "applyToTeam",
  "acceptInvitation",
  "readMemberContact",
] as const;
export const captainActions = [
  "editExistingTeam",
  "sendInvitation",
  "removeMember",
  "dissolveTeam",
] as const;
export const recoveryActions = [
  "leaveTeam",
  "reject",
  "withdraw",
  "closeRecruitment",
  "revokeInvitation",
  "revokeContactGrant",
] as const;
export type BusinessAction =
  | (typeof sensitiveActions)[number]
  | (typeof captainActions)[number]
  | (typeof recoveryActions)[number];

export type CampusQualification = {
  status: "unavailable" | "unverified" | "valid" | "expired" | "revoked";
  validUntil: Date | null;
};
export interface CampusProvider {
  read(tx: AccessTransaction, userId: string): Promise<CampusQualification>;
}
export interface ResourceRelationship {
  // 提供者从真实业务数据校验归属、截止、容量、角色等资源规则。
  allowed: boolean;
  isCaptain: boolean;
  contact?: {
    ownerId: string;
    sameTeam: boolean;
    viewerIsMember: boolean;
    ownerIsMember: boolean;
    granted: boolean;
  };
}
export interface ResourceProvider {
  read(
    tx: AccessTransaction,
    actorId: string,
    action: BusinessAction,
    resourceId: string,
  ): Promise<ResourceRelationship | undefined>;
  hasActiveCaptainTeam(tx: AccessTransaction, userId: string): Promise<boolean>;
}
export interface LifecycleParticipant {
  check(tx: AccessTransaction, userId: string): Promise<void>;
  revoke(tx: AccessTransaction, userId: string, now: Date): Promise<void>;
  // #138 在七天后调用；重复执行须安全，失败须抛出，不负责最终释放身份绑定。
  cleanup(tx: AccessTransaction, userId: string, now: Date): Promise<void>;
}
export interface SchoolSessionParticipant {
  destroy(input: { userId: string; sessionId?: string }): Promise<void>;
}
export type Capability =
  | "campus"
  | "resources"
  | "contact-revocation"
  | "business-cleanup"
  | "governance"
  | "school-sessions";
export interface DataModule {
  id: string;
  kind: "production" | "test";
  lifecycle: LifecycleParticipant;
  campus?: CampusProvider;
  resources?: ResourceProvider;
  schoolSessions?: SchoolSessionParticipant;
  capabilities: readonly Capability[];
}
