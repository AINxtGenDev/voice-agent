import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredential, parseCredential } from '../src/credentials.mjs';

test('selects the named record without taking another provider secret', () => {
  assert.equal(parseCredential('name: other\nAPI-key: sk-other\nname: voice\nAPI-key: sk-test\nname: next\nAPI-key: sk-next'), 'sk-test');
  assert.equal(parseCredential('voice="sk-test"'), 'sk-test');
  assert.equal(parseCredential('name: voice\nAPI-key: sk-test\nAccount-SID: ACfixture\nAPI-key: other-provider'), 'sk-test');
});

test('rejects missing, duplicate and invalid entries without leaking their contents', () => {
  assert.throws(() => parseCredential('OPENAI_API_KEY=sk-other'), /exactly one/);
  assert.throws(() => parseCredential('voice=sk-first\nvoice=sk-second'), /exactly one/);
  assert.throws(() => parseCredential('voice=private-secret'), { message: 'Selected credential has an unsupported format.' });
});

test('requires private file permissions and does not source shell code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-credential-test-'));
  const path = join(directory, '.env');
  try {
    await writeFile(path, 'voice=sk-test\nOTHER=$(exit 99)', { mode: 0o600 });
    assert.equal(await loadCredential({ OPENAI_API_KEY_FILE: path }), 'sk-test');
    await chmod(path, 0o644);
    await assert.rejects(loadCredential({ OPENAI_API_KEY_FILE: path }), /regular private file/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
