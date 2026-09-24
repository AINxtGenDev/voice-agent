import { open } from 'node:fs/promises';

const keyPattern = /^sk-[A-Za-z0-9_-]+$/;

// Parse only the requested record. Never execute/source a shared credential file.
export function parseCredential(text, label = 'voice') {
  const candidates = [];
  let selected = false;
  for (const line of text.split(/\r?\n/)) {
    const record = line.match(/^\s*name\s*:\s*([^#]+?)\s*$/i);
    if (record) {
      selected = record[1] === label;
      continue;
    }
    const assignment = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    const namedKey = selected && line.match(/^\s*API-key\s*:\s*(.*?)\s*$/i);
    // A named record owns one key, not later providers in a shared file.
    if (namedKey) selected = false;
    let value = namedKey ? namedKey[1] : assignment?.[1] === label ? assignment[2] : null;
    if (value === null) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!keyPattern.test(value)) throw new Error('Selected credential has an unsupported format.');
    candidates.push(value);
  }
  if (candidates.length !== 1) throw new Error('Expected exactly one matching credential record.');
  return candidates[0];
}

export async function loadCredential(env = process.env) {
  if (env.OPENAI_API_KEY) {
    if (!keyPattern.test(env.OPENAI_API_KEY)) throw new Error('OPENAI_API_KEY has an unsupported format.');
    return env.OPENAI_API_KEY;
  }
  if (!env.OPENAI_API_KEY_FILE) throw new Error('Set OPENAI_API_KEY_FILE or OPENAI_API_KEY on the server.');
  let file;
  try {
    file = await open(env.OPENAI_API_KEY_FILE, 'r');
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || (info.mode & 0o077) !== 0) {
      throw new Error('Credential file must be a regular private file (0600 or 0400), at most 1 MiB.');
    }
    return parseCredential(await file.readFile('utf8'), env.OPENAI_API_KEY_NAME || 'voice');
  } catch (error) {
    if (error.code) throw new Error('Credential file could not be read.');
    throw error;
  } finally {
    await file?.close();
  }
}
