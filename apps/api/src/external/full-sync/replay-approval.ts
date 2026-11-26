import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readLocalSecret } from '../../local-secrets.js';
import { jsonHash } from '../normalize.js';
import type { AdmissionReplayRequest } from './admission-replay.js';
import { FullSyncError } from './types.js';
import { defaultHeavyWorkPausePercent, heavyWorkPausePercentSchema, reachedHeavyWorkPause, type HeavyWorkPausePercent } from './disk-policy.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const release = z.string().regex(/^[a-f0-9]{40}$/);
const time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const batch = z.strictObject({
  id: z.uuid(), snapshotId: z.uuid(), csvSha256: digest,
  expectedAdmitted: count, expectedLimit: count, targetRows: count,
  eventCount: count.min(1).max(25), eventSetSha256: digest,
});
const prospective = z.object({
  kind: z.literal('replay-prospective-capacity-v1'), release, batch,
  preflightAt: time, sourceNativeExpiresAt: time, workerFence: count.min(1),
  diskTotalBytes: count.min(1), estimatedPeakBytes: count.min(1),
  heavyWorkPausePercent: heavyWorkPausePercentSchema.default(defaultHeavyWorkPausePercent),
  quota: z.object({ requiredInitialDetailIds: count, operatorApprovedRetryIds: count,
    verifiedRemainingDetailIds: count, accountCheckedAt: time }),
});
const checked = z.strictObject({
  kind: z.literal('replay-prewrite-checked-v1'), release, batch,
  prospectiveReceiptSha256: digest, checkedAt: time,
});
export type ReplayOperatorApproval = { workerFence: string; expiresAt: number; heavyWorkPausePercent: HeavyWorkPausePercent };

/** Recheck the host-issued, read-only receipts at the private production command boundary. */
export function validateReplayApproval(plan: AdmissionReplayRequest, expectedRelease: string | undefined,
  raw: string, checkedRaw: string, now = Date.now(),
  heavyWorkPausePercent:HeavyWorkPausePercent=defaultHeavyWorkPausePercent): ReplayOperatorApproval {
  try {
    const forecast = prospective.parse(JSON.parse(raw));
    const proof = checked.parse(JSON.parse(checkedRaw));
    const eventSetSha256 = jsonHash([...plan.eventIds].sort());
    const { id, snapshotId, csvSha256, expectedAdmitted, expectedLimit, targetRows } = plan;
    const expected = jsonHash({ id, snapshotId, csvSha256, expectedAdmitted, expectedLimit, targetRows,
      eventCount: plan.eventIds.length, eventSetSha256 });
    const hash = createHash('sha256').update(raw).digest('hex');
    const preflight = Date.parse(forecast.preflightAt);
    const confirmed = Date.parse(proof.checkedAt);
    const day = new Date(now).toISOString().slice(0,10);
    const expiresAt = Math.min(preflight + 60_000, Date.parse(forecast.sourceNativeExpiresAt),
      Date.parse(day+'T00:00:00Z') + 86_400_000);
    const { quota } = forecast;
    const accountAt = Date.parse(quota.accountCheckedAt);
    if (forecast.release === expectedRelease && proof.release === expectedRelease &&
        hash === plan.capacityReceipt && proof.prospectiveReceiptSha256 === hash &&
        jsonHash(forecast.batch) === expected && jsonHash(proof.batch) === expected &&
        preflight <= confirmed && confirmed <= now && now < expiresAt &&
        accountAt <= preflight && new Date(accountAt).toISOString().slice(0,10) === day &&
        quota.requiredInitialDetailIds === plan.eventIds.length * 3 &&
        quota.operatorApprovedRetryIds <= quota.verifiedRemainingDetailIds - quota.requiredInitialDetailIds &&
        forecast.heavyWorkPausePercent === heavyWorkPausePercent &&
        !reachedHeavyWorkPause(forecast.estimatedPeakBytes,forecast.diskTotalBytes,heavyWorkPausePercent)) {
      return { workerFence: String(forecast.workerFence), expiresAt, heavyWorkPausePercent };
    }
  } catch { /* Operator evidence is private. Do not report the payload or parser details. */ }
  throw new FullSyncError('SYNC_REPLAY_APPROVAL_INVALID');
}

export function readReplayApproval(plan: AdmissionReplayRequest, expectedRelease: string | undefined,
  heavyWorkPausePercent:HeavyWorkPausePercent=defaultHeavyWorkPausePercent) {
  try {
    return validateReplayApproval(plan, expectedRelease,
      readLocalSecret('/private/replay/capacity.json', 65_536, true),
      readLocalSecret('/private/replay/checked.json', 65_536), Date.now(), heavyWorkPausePercent);
  } catch {
    throw new FullSyncError('SYNC_REPLAY_APPROVAL_INVALID');
  }
}
