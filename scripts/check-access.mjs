import { loadCredential } from '../src/credentials.mjs';

try {
  const apiKey = await loadCredential();
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Access check failed (HTTP ${response.status}).`);
  const body = await response.json();
  const ids = new Set(body.data?.map((model) => model.id));
  const available = ids.has('gpt-live-1');
  console.log(JSON.stringify({ authenticated: true, liveModelListed: available, backendModelListed: ids.has('gpt-5.6-terra') }));
  if (!available) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof TypeError ? 'Network access check failed.' : error.message);
  process.exitCode = 1;
}
