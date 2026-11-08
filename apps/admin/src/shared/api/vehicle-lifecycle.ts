import { AdminVehicleResponseSchema, DeleteVehicleRequestSchema, RestoreVehicleRequestSchema, type AdminVehicle } from '@hd/contracts/admin';
import { request } from './client';

export async function mutateVehicleLifecycle(operation: 'delete' | 'restore', id: string, version: number, key: string): Promise<AdminVehicle> {
  const body = (operation === 'delete' ? DeleteVehicleRequestSchema : RestoreVehicleRequestSchema).parse({ version });
  const path = `/api/v1/admin/vehicles/${encodeURIComponent(id)}${operation === 'restore' ? '/restore' : ''}`;
  return (await request(path, AdminVehicleResponseSchema, {
    method: operation === 'delete' ? 'DELETE' : 'POST',
    headers: { 'Idempotency-Key': key }, body: JSON.stringify(body),
  })).data;
}

// Mutation receipts may be replayed historical snapshots. Always reconcile with this read.
export async function readVehicleLifecycle(id: string): Promise<{ vehicle: AdminVehicle; isDeleted: boolean }> {
  const vehicle = (await request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}?includeDeleted=true`, AdminVehicleResponseSchema)).data;
  return { vehicle, isDeleted: vehicle.deletedAt !== null };
}
