export type VehicleLifecycleOperation = 'delete' | 'restore';
export type VehicleLifecycleIntent = Readonly<{
  operation: VehicleLifecycleOperation;
  vehicleId: string;
  version: number;
  key: string;
  startedAt: number;
}>;

/** One immutable employee intent is reused until its current outcome is established. */
export function makeVehicleLifecycleIntent(
  operation: VehicleLifecycleOperation,
  vehicleId: string,
  version: number,
  key: string,
  now: number,
): VehicleLifecycleIntent {
  return Object.freeze({ operation, vehicleId, version, key, startedAt: now });
}

/** A later rejection cannot disprove an earlier request or a successful historical receipt. */
export function keepVehicleLifecycleIntent(status: number, wasUncertain: boolean, receiptAccepted: boolean): boolean {
  return wasUncertain || receiptAccepted || ![400, 401, 403, 404, 409, 413, 422].includes(status);
}

export function vehicleLifecycleIntentExpired(intent: VehicleLifecycleIntent, now: number): boolean {
  return now - intent.startedAt >= 24 * 60 * 60 * 1000;
}
