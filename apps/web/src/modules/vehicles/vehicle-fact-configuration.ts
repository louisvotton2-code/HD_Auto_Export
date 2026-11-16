import type { DisplayText, PublicVehicleInline } from '@hd/contracts/public';
import type { VehicleFactId, VehicleFactRow } from './public-presentation';

type Match = NonNullable<PublicVehicleInline['technicalDetails']>['configurationMatches'][number];
type ConfigItem = { id: string; name: DisplayText; value: DisplayText };

const factIds = {
  displacementCc: 'displacementCc',
  powerKw: 'powerKw',
  powerHp: 'powerHp',
  engineKw: 'engineKw',
  motorKw: 'motorKw',
  systemKw: 'systemKw',
  engineHp: 'engineHp',
  motorHp: 'motorHp',
  systemHp: 'systemHp',
  bodyType: 'body',
  transmissionType: 'transmission',
  driveType: 'drivetrain',
  vehicleClass: 'vehicleClass',
  energyType: 'powertrain',
} satisfies Record<Match['semanticKey'], VehicleFactId>;

/** Hide only BE-confirmed duplicates of facts visible in this locale. */
export function configurationWithoutShownFacts<T extends ConfigItem>(
  items: readonly T[],
  facts: readonly VehicleFactRow[],
  matches: readonly Match[] = [],
): T[] {
  const visibleFacts = new Set(facts.map(fact => fact.id));
  const hidden = new Set(matches.filter(match => visibleFacts.has(factIds[match.semanticKey]))
    .map(match => match.id));
  return items.filter(item => !hidden.has(item.id)
    || item.name.status !== 'ready' || !item.name.text.trim()
    || item.value.status !== 'ready' || !item.value.text.trim());
}
