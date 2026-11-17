import { z } from 'zod';
import { VehicleFactsSchema } from './common.js';

export const VEHICLE_POWER_DETAIL_KEYS = ['engineKw', 'motorKw', 'systemKw', 'engineHp', 'motorHp', 'systemHp'] as const;
const power = VehicleFactsSchema.shape.powerKw.unwrap().optional();
const VehicleTechnicalPowerSchema = z.strictObject({ engineKw: power, motorKw: power, systemKw: power, engineHp: power, motorHp: power, systemHp: power });
const itemId = z.string().regex(/^cfg-(?:[0-9a-f]{4}){1,100}$/);
const classText = z.string().max(120).regex(/\S/u);
export const VehicleTechnicalFactsSchema = VehicleTechnicalPowerSchema.extend({
  identityHash: z.string().regex(/^[a-f0-9]{64}$/),
  vehicleClass: z.strictObject({ id: itemId, value: z.strictObject({ zh: classText, en: classText, ru: classText }) }).optional(),
});
export type VehicleTechnicalFacts = z.infer<typeof VehicleTechnicalFactsSchema>;
export const VehicleDetailMatchKeySchema = z.enum([
  'displacementCc', 'powerKw', 'powerHp', ...VEHICLE_POWER_DETAIL_KEYS, 'bodyType', 'transmissionType', 'driveType', 'vehicleClass', 'energyType',
]);
export type VehicleDetailMatchKey = z.infer<typeof VehicleDetailMatchKeySchema>;
/** Supplier IDs come from the documented configuration projector, never label inference. */
export const SUPPLIER_TECHNICAL_CONFIGURATION_KEYS = {
  'specs.displacementCc': 'displacementCc',
  'specs.powerKw': 'powerKw',
  'specs.engineKw': 'engineKw',
  'specs.motorKw': 'motorKw',
  'specs.ev.motorPowerKw': 'motorKw',
  'specs.systemKw': 'systemKw',
  'specs.engineHp': 'engineHp',
  'specs.motorHp': 'motorHp',
  'specs.bodyType': 'bodyType',
  'specs.transmissionType': 'transmissionType',
  'specs.driveType': 'driveType',
} as const satisfies Record<string, VehicleDetailMatchKey>;

const supplierItemId = z.enum(Object.keys(SUPPLIER_TECHNICAL_CONFIGURATION_KEYS));
export const VehicleTechnicalDetailsSchema = z.strictObject({
  power: VehicleTechnicalPowerSchema,
  configurationMatches: z.array(z.strictObject({
    id: z.union([itemId,supplierItemId]), semanticKey: VehicleDetailMatchKeySchema, source: z.enum(['record', 'configuration']),
  })).max(200),
});
export type VehicleTechnicalDetails = z.infer<typeof VehicleTechnicalDetailsSchema>;
