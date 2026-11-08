import { describe, expect, it } from 'vitest';
import { keepVehicleLifecycleIntent, makeVehicleLifecycleIntent, vehicleLifecycleIntentExpired } from './vehicle-deletion-model';

describe('reversible vehicle lifecycle recovery', () => {
  it('freezes the operation, vehicle, version and key for exact retries', () => {
    const original = { id: 'vehicle-a', version: 7 };
    const intent = makeVehicleLifecycleIntent('delete', original.id, original.version, 'delete-key-123', 1000);
    original.id = 'vehicle-b'; original.version = 8;
    expect(intent).toEqual({ operation: 'delete', vehicleId: 'vehicle-a', version: 7, key: 'delete-key-123', startedAt: 1000 });
    expect(Object.isFrozen(intent)).toBe(true);
  });
  it('retains an uncertain delete or restore after later auth and version rejections', () => {
    expect(keepVehicleLifecycleIntent(0, false, false)).toBe(true);
    expect(keepVehicleLifecycleIntent(503, false, false)).toBe(true);
    expect(keepVehicleLifecycleIntent(401, true, false)).toBe(true);
    expect(keepVehicleLifecycleIntent(409, true, false)).toBe(true);
  });
  it('does not treat a historical success receipt as the current state when the read fails', () => {
    for (const status of [401, 403, 404, 409, 503]) expect(keepVehicleLifecycleIntent(status, false, true)).toBe(true);
  });
  it('clears only a first explicit rejection that could not have mutated the record', () => {
    expect(keepVehicleLifecycleIntent(409, false, false)).toBe(false);
    expect(keepVehicleLifecycleIntent(401, false, false)).toBe(false);
    expect(keepVehicleLifecycleIntent(422, false, false)).toBe(false);
  });
  it('requires read-only result reconciliation at the 24-hour retention boundary', () => {
    const intent = makeVehicleLifecycleIntent('restore', 'vehicle-a', 3, 'restore-key-123', 1000);
    expect(vehicleLifecycleIntentExpired(intent, 1000 + 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(vehicleLifecycleIntentExpired(intent, 1000 + 24 * 60 * 60 * 1000)).toBe(true);
  });
});
