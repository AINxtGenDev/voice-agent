import { open } from 'node:fs/promises';

export function parseTwilioCredentials(text) {
  const aliases = new Map([
    ['TWILIO_ACCOUNT_SID', 'accountSid'], ['Account-SSID', 'accountSid'], ['Account-SID', 'accountSid'],
    ['TWILIO_AUTH_TOKEN', 'authToken'], ['Auth-Token', 'authToken'],
    // Twilio issues a separate Auth Token per region; calls here use IE1.
    ['TWILIO_IE1_AUTH_TOKEN', 'ie1AuthToken'], ['IE1-Auth-Token', 'ie1AuthToken'],
    ['TWILIO_FROM_NUMBER', 'fromNumber'], ['Twilio phone-number', 'fromNumber'],
  ]);
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_ -]*)\s*[:=]\s*(.*?)\s*$/);
    if (!match) continue;
    const name = aliases.get(match[1].trim());
    if (!name) continue;
    if (result[name] !== undefined) throw new Error('Duplicate Twilio configuration field.');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[name] = name === 'fromNumber' ? value.replace(/[\s()-]/g, '') : value;
  }
  if (result.ie1AuthToken !== undefined) { result.authToken = result.ie1AuthToken; delete result.ie1AuthToken; }
  if (!/^AC[0-9a-fA-F]{32}$/.test(result.accountSid ?? '') || !/^[0-9a-fA-F]{32}$/.test(result.authToken ?? '') || !/^\+[1-9][0-9]{7,14}$/.test(result.fromNumber ?? '')) {
    throw new Error('Twilio Account SID, Auth Token, or caller number is missing or invalid.');
  }
  return result;
}

export async function loadTwilioCredentials(path) {
  let file;
  try {
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || (info.mode & 0o077) !== 0) throw new Error('Twilio credential file must be a private regular file.');
    return parseTwilioCredentials(await file.readFile('utf8'));
  } catch (error) {
    if (error.code) throw new Error('Twilio credential file could not be read.');
    throw error;
  } finally { await file?.close(); }
}
