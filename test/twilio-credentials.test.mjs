import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTwilioCredentials } from '../src/twilio-credentials.mjs';

test('Twilio credential parser selects only supported fields in the supplied file format', () => {
  const sid = 'AC' + '1'.repeat(32);
  const token = '2'.repeat(32);
  assert.deepEqual(parseTwilioCredentials(`Account-SSID: ${sid}\nAuth-Token: ${token}\nTwilio phone-number: +1 (202) 555-0100\nRecovery-code: DO-NOT-USE`), { accountSid: sid, authToken: token, fromNumber: '+12025550100' });
  assert.throws(() => parseTwilioCredentials(`TWILIO_ACCOUNT_SID=${sid}\nAccount-SSID: ${sid}`), /Duplicate/);
  const ie1 = '3'.repeat(32);
  assert.equal(parseTwilioCredentials(`Account-SSID: ${sid}\nAuth-Token: ${token}\nTwilio phone-number: +12025550100\nIE1-Auth-Token: ${ie1}`).authToken, ie1);
  assert.throws(() => parseTwilioCredentials(`Account-SSID: ${sid}\nIE1-Auth-Token: ${ie1}\nTWILIO_IE1_AUTH_TOKEN=${ie1}\nTwilio phone-number: +12025550100`), /Duplicate/);
  assert.throws(() => parseTwilioCredentials('Auth-Token: confidential'), { message: 'Twilio Account SID, Auth Token, or caller number is missing or invalid.' });
});
