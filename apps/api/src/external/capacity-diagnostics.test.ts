import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { capacityFailureCollector } from './scale-bench.js';

test('real lazy Fastify injections preserve independent query attribution for concurrent failures', async () => {
  const app = Fastify();
  const collector = capacityFailureCollector(2);
  app.get('/api/v1/vehicles', async request => {
    await new Promise<void>(resolve => setImmediate(resolve));
    throw Object.assign(new Error('private-query-sentinel'), { code: (request.query as {kind:string}).kind });
  });
  app.setErrorHandler((error, _request, reply) => {
    collector.observe({ route:'/api/v1/vehicles', status:500, code: (error as {code?:string}).code === 'pool' ?
      'POOL_ACQUIRE_TIMEOUT' : 'SQL_STATEMENT_CANCELLED', stage: (error as {code?:string}).code === 'pool' ? 'pool_acquire' : 'statement' });
    return reply.code(500).send({ error:'unchanged-test-failure' });
  });
  try {
    const results = await Promise.all(Array.from({length:8}, (_, index) => collector.run(index % 2,
      () => app.inject({url:`/api/v1/vehicles?kind=${index % 2 ? 'sql' : 'pool'}`}))));
    assert.ok(results.every(response => response.statusCode === 500));
    assert.deepEqual(collector.reasons(0), [{route:'/api/v1/vehicles',status:500,code:'POOL_ACQUIRE_TIMEOUT',stage:'pool_acquire',count:4}]);
    assert.deepEqual(collector.reasons(1), [{route:'/api/v1/vehicles',status:500,code:'SQL_STATEMENT_CANCELLED',stage:'statement',count:4}]);
    assert.equal(collector.unattributedFailures(), 0);
    assert.doesNotMatch(JSON.stringify([collector.reasons(0),collector.reasons(1)]), /sentinel|kind=|message|stack/);
    collector.observe({route:'/api/v1/vehicles',status:500,code:'OTHER',stage:'unknown'});
    assert.equal(collector.unattributedFailures(), 1);
  } finally { await app.close(); }
});
