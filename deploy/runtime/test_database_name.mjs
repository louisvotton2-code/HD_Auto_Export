import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentDatabaseName,deploymentDatabaseIdentity} from './database-name.mjs';

test('existing database remains the default; release targets are explicit and bounded', () => {
  assert.equal(deploymentDatabaseName(), 'hd_auto');
  assert.equal(deploymentDatabaseName('hd_release_123456789abc'), 'hd_release_123456789abc');
  assert.equal(deploymentDatabaseName('hd_release_' + 'a'.repeat(40)), 'hd_release_' + 'a'.repeat(40));
});
test('connection options, quoted identifiers, foreign and malformed targets fail closed', () => {
  for (const value of ['', 'postgres', 'hd_auto/other', 'hd_auto?host=elsewhere', 'hd_release_abc', 'hd_release_' + 'a'.repeat(41), 'HD_AUTO', 'hd_auto\n', 'hd_auto;DROP DATABASE postgres', null]) {
    assert.throws(() => deploymentDatabaseName(value));
  }
});

test('release roles are isolated from the retained old database credential', () => {
  assert.deepEqual(deploymentDatabaseIdentity(), {database:'hd_auto',user:'hd_app'});
  assert.deepEqual(deploymentDatabaseIdentity('hd_release_123456789abc'), {database:'hd_release_123456789abc',user:'hd_release_123456789abc_app'});
  assert.throws(() => deploymentDatabaseIdentity('postgres'));
});
