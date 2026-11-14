import { equipmentIconName } from '../equipment-icon';
import { equipmentIconSvg, type EquipmentSvg } from '../equipment-icon-svg';

/** Decorative item geometry only; the adjacent configuration name remains the accessible label. */
export function EquipmentIcon({ label, fieldId, size = 18, className }: {
  label?: string | null;
  fieldId?: string;
  size?: number;
  className?: string;
}) {
  const name = equipmentIconName(label, fieldId);
  const glyph: EquipmentSvg = equipmentIconSvg[name];
  return <svg
    data-equipment-icon={name}
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={glyph.fill}
    stroke="currentColor"
    strokeWidth={glyph.strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {glyph.paths.map((d, index) => <path key={index} d={d} />)}
    {glyph.circles.map((circle, index) => <circle key={`circle-${index}`} {...circle} />)}
  </svg>;
}
