import { loadTwilioCredentials } from '../src/twilio-credentials.mjs';
import { verifyTwilioAccess } from '../src/twilio-access.mjs';

try {
  const credentials = await loadTwilioCredentials(process.env.TWILIO_CREDENTIAL_FILE);
  const result = await verifyTwilioAccess(credentials);
  console.log(JSON.stringify(result));
  if (!result.ready) process.exitCode = 1;
} catch { console.error('Twilio configuration could not be read. Set TWILIO_CREDENTIAL_FILE to a private file.'); process.exitCode = 1; }
