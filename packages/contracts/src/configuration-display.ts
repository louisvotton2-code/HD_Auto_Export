import { z } from 'zod';
import { DisplayTextSchema } from './localization.js';

export const ConfigurationItemIdSchema = z.string().regex(/^cfg-(?:[0-9a-f]{4}){1,100}$/);
/** Shared by public detail and private preview. No internal cost, raw draft or engine metadata. */
export const ConfigurationDisplaySchema = z.strictObject({
  version: z.literal(1),
  items: z.array(z.strictObject({ id: ConfigurationItemIdSchema, name: DisplayTextSchema, value: DisplayTextSchema })).min(1).max(200),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map(item => item.id)).size !== value.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Configuration identities must be unique.' });
  for (const [index, item] of value.items.entries()) if ((item.name.text?.length ?? 0) > 100)
    ctx.addIssue({ code: 'custom', path: ['items', index, 'name', 'text'], message: 'Configuration names are limited to 100 UTF-16 units.' });
});
export type ConfigurationDisplay = z.infer<typeof ConfigurationDisplaySchema>;
