/** The Russian recycling tariff uses different certified power definitions by propulsion. */
export function powerBasis(powertrain: unknown) {
  if (powertrain === 'bev' || powertrain === 'erev') return 'electricPower';
  if (powertrain === 'hev' || powertrain === 'phev') return 'hybridPower';
  return 'power';
}
