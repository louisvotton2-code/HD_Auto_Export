import { calculateImportEstimate, type CalculationInput } from '../index';
import { readCalculationBody } from './request-body';

function respond(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Calculation-Mode': 'reference-only' },
  });
}

const stringFields = [
  'country',
  'importerType',
  'powertrain',
  'price',
  'currency',
  'displacementCc',
  'powerHp',
  'manufactureDate',
  'customsDate',
  'freight',
  'insurance',
  'steering',
  'transactionRate',
  'euroRate',
] as const;

/**
 * Optional backend adapter, deliberately outside app/: the static website exposes no HTTP API.
 * A future separately deployed service can call this handler after adding its own route policy.
 */
export async function handleCalculationRequest(request: Request) {
  const bodyResult = await readCalculationBody(request);
  if (!bodyResult.ok) return respond({ error: bodyResult.error }, bodyResult.status);
  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    return respond({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return respond({ error: 'invalid_request' }, 400);
  const source = body as Record<string, unknown>;
  if (
    stringFields.some((field) => typeof source[field] !== 'string' || source[field].length > 64)
  ) {
    return respond({ error: 'invalid_request', requiredFields: stringFields }, 400);
  }
  const input = Object.fromEntries(
    stringFields.map((field) => [field, source[field]]),
  ) as unknown as CalculationInput;
  for (const field of ['condition', 'usdRate'] as const) {
    if (source[field] === undefined) continue;
    if (typeof source[field] !== 'string' || source[field].length > 64)
      return respond({ error: 'invalid_request' }, 400);
    Object.assign(input, { [field]: source[field] });
  }
  const result = calculateImportEstimate(input);
  return respond(
    result,
    result.status === 'invalid' ? 400 : result.status === 'incomplete' ? 422 : 200,
  );
}
