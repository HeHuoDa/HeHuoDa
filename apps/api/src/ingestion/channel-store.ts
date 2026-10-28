import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type Channel,
  type Source,
  sources,
} from "@hehuoda/sicau-connectors/notices";

export type ChannelVerificationStatus = "pending" | "verified" | "rejected";

export interface ChannelRow {
  source_id: string;
  id: string;
  data: Channel;
  enabled: boolean;
  settings: Record<string, number>;
  verification_status: ChannelVerificationStatus;
  verification: unknown;
  verified_at: Date | null;
  verified_by: string | null;
  activated_on: string | null;
  last_started_at: Date | null;
  last_successful_check: Date | null;
  failure_count: number;
  backoff_until: Date | null;
  rotation_seq: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/** Hashes the channel's complete static definition and its source origin. */
export function channelFingerprint(source: Source, channel: Channel): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          host: source.host,
          collegeId: source.collegeId,
          channel,
        }),
      ),
    )
    .digest("hex");
}

/**
 * Refreshes only static channel definitions. Migration 0009 seeds legacy
 * defaults from source enabled/settings; later newly introduced channels are
 * inserted disabled and with empty settings. Operational state is never reset.
 */
export async function initializeChannels(pool: Pool): Promise<void> {
  const table = await pool.query<{ table_name: string | null }>(
    "SELECT to_regclass('ingestion_channels')::text AS table_name",
  );
  if (!table.rows[0]?.table_name) return;

  for (const source of sources) {
    for (const channel of source.channels) {
      await pool.query(
        `INSERT INTO ingestion_channels(source_id,id,data,enabled,settings)
         SELECT $1,$2,$3,false,'{}'::jsonb
         FROM ingestion_sources WHERE id=$1
         ON CONFLICT(source_id,id) DO UPDATE SET data=EXCLUDED.data`,
        [source.id, channel.id, channel],
      );
    }

    const defaultChannel = source.channels.find(
      (channel) => channel.id === source.defaultChannelId,
    );
    if (defaultChannel)
      await pool.query(
        `UPDATE ingestion_runs
            SET config_hash=$2
          WHERE source_id=$1 AND channel_id='default'
            AND phase IS NULL AND config_hash IS NULL`,
        [source.id, channelFingerprint(source, defaultChannel)],
      );
  }
}

export async function readChannel(
  pool: Pick<PoolClient, "query">,
  sourceId: string,
  channelId: string,
): Promise<ChannelRow | undefined> {
  const result = await pool.query<ChannelRow>(
    `SELECT source_id,id,data,enabled,settings,verification_status,
            verification,verified_at,verified_by,activated_on,last_started_at,
            last_successful_check,failure_count,backoff_until,rotation_seq
       FROM ingestion_channels
      WHERE source_id=$1 AND id=$2`,
    [sourceId, channelId],
  );
  return result.rows[0];
}
