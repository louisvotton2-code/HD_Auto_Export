import { z } from 'zod';

/** String lengths use UTF-16 code units; JSON input size uses UTF-8 bytes. */
export const VEHICLE_CONFIGURATION_LIMITS = Object.freeze({
  items: 200,
  nameUtf16: 100,
  valueUtf16: 500,
  totalUtf16: 16_000,
  jsonBytes: 64 * 1024,
  jsonDepth: 8,
  jsonNodes: 2048,
});

function exactText(max: number) {
  return z.string().min(1).max(max).regex(/^\S(?:[\s\S]*\S)?(?![\s\S])/u, 'Text must be nonblank and have no leading or trailing whitespace')
    .refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value), 'Text must be valid database Unicode without NUL or unpaired surrogates');
}

const ConfigurationNameSchema = exactText(VEHICLE_CONFIGURATION_LIMITS.nameUtf16);
export const VehicleConfigurationItemSchema = z.strictObject({
  name: ConfigurationNameSchema,
  value: exactText(VEHICLE_CONFIGURATION_LIMITS.valueUtf16),
});

/** Values, units, ordering and spelling are source data; validation never normalizes them. */
export const VehicleConfigurationSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(VehicleConfigurationItemSchema).min(1).max(VEHICLE_CONFIGURATION_LIMITS.items),
}).superRefine((configuration, ctx) => {
  const names = new Set<string>();
  let contentLength = 0;
  configuration.items.forEach((item, index) => {
    const comparisonName = item.name.normalize('NFKC').trim().toLowerCase();
    if (names.has(comparisonName)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'name'], message: 'Configuration names must be unique after NFKC, trim and lowercase comparison' });
    }
    names.add(comparisonName);
    contentLength += item.name.length + item.value.length;
  });
  if (contentLength > VEHICLE_CONFIGURATION_LIMITS.totalUtf16) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: `Combined name and value length must not exceed ${VEHICLE_CONFIGURATION_LIMITS.totalUtf16}` });
  }
});
export type VehicleConfiguration = z.infer<typeof VehicleConfigurationSchema>;
export type VehicleConfigurationItem = z.infer<typeof VehicleConfigurationItemSchema>;

export const vehicleConfigurationExample: VehicleConfiguration = {
  version: 1,
  items: [{ name: '排量(cc)', value: '1989' }, { name: '挡位数', value: '8' }],
};

/** JSON Schema covers structure and per-field bounds. Run the runtime schema for uniqueness and aggregate length too. */
export const vehicleConfigurationJsonSchema = z.toJSONSchema(VehicleConfigurationSchema);

/**
 * Lossless UTF-16 hex encoding, not a hash: distinct exact names have distinct IDs.
 * A valid name uses 1..100 UTF-16 code units, so IDs use 8..404 ASCII characters.
 * Reordering items or changing a value keeps its ID; renaming creates a new identity.
 */
export function vehicleConfigurationItemId(name: string): string {
  ConfigurationNameSchema.parse(name);
  let encoded = 'cfg-';
  for (let index = 0; index < name.length; index++) encoded += name.charCodeAt(index).toString(16).padStart(4, '0');
  return encoded;
}

type JsonPath = Array<string | number>;
function invalidJson(path: JsonPath, message: string): never {
  throw new z.ZodError([{ code: 'custom', path, message }]);
}

/**
 * Parse the original pasted text, before JSON.parse can discard duplicate properties.
 * Empty input is invalid here; the draft request wrapper owns explicit clearing/null.
 * Parsing is bounded by UTF-8 bytes, nesting and value count, and has no I/O.
 */
export function parseVehicleConfigurationJson(raw: string): VehicleConfiguration {
  if (typeof raw !== 'string') invalidJson([], 'Configuration JSON must be a string');
  if (raw.length > VEHICLE_CONFIGURATION_LIMITS.jsonBytes || new TextEncoder().encode(raw).byteLength > VEHICLE_CONFIGURATION_LIMITS.jsonBytes) {
    invalidJson([], `Configuration JSON must not exceed ${VEHICLE_CONFIGURATION_LIMITS.jsonBytes} UTF-8 bytes`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { invalidJson([], 'Expected one strict JSON document without code fences or explanatory text'); }

  // Native parsing above establishes valid JSON syntax. This bounded second pass
  // retains property tokens, including escaped spellings that decode to one key.
  let cursor = 0;
  let nodes = 0;
  function whitespace() {
    while (raw[cursor] === ' ' || raw[cursor] === '\t' || raw[cursor] === '\r' || raw[cursor] === '\n') cursor++;
  }
  function stringToken(): string {
    const start = cursor++;
    while (cursor < raw.length) {
      const character = raw[cursor++];
      if (character === '"') return JSON.parse(raw.slice(start, cursor)) as string;
      if (character === '\\') cursor++;
    }
    return invalidJson([], 'Unterminated JSON string');
  }
  function value(path: JsonPath, depth: number): void {
    if (++nodes > VEHICLE_CONFIGURATION_LIMITS.jsonNodes) invalidJson(path, 'Configuration JSON has too many values');
    if (depth > VEHICLE_CONFIGURATION_LIMITS.jsonDepth) invalidJson(path, 'Configuration JSON is nested too deeply');
    whitespace();
    if (raw[cursor] === '{') {
      cursor++;
      whitespace();
      const keys = new Set<string>();
      if (raw[cursor] !== '}') {
        while (true) {
          const key = stringToken();
          if (keys.has(key)) invalidJson([...path, key], 'Duplicate JSON property');
          keys.add(key);
          whitespace();
          cursor++; // colon, already checked by native JSON parsing
          value([...path, key], depth + 1);
          whitespace();
          if (raw[cursor] !== ',') break;
          cursor++;
          whitespace();
        }
      }
      cursor++;
    } else if (raw[cursor] === '[') {
      cursor++;
      whitespace();
      let index = 0;
      if (raw[cursor] !== ']') {
        while (true) {
          value([...path, index++], depth + 1);
          whitespace();
          if (raw[cursor] !== ',') break;
          cursor++;
        }
      }
      cursor++;
    } else if (raw[cursor] === '"') {
      stringToken();
    } else {
      while (cursor < raw.length && !/[,\]} \t\r\n]/.test(raw[cursor]!)) cursor++;
    }
  }
  value([], 0);
  return VehicleConfigurationSchema.parse(parsed);
}
