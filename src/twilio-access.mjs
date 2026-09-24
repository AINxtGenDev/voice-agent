import twilio from 'twilio';

export async function verifyTwilioAccess(credentials, client = twilio(credentials.accountSid, credentials.authToken, { autoRetry: false, timeout: 10000 })) {
  try {
    const [account, numbers, verified] = await Promise.all([
      client.api.accounts(credentials.accountSid).fetch(),
      client.incomingPhoneNumbers.list({ phoneNumber: credentials.fromNumber, limit: 1 }),
      client.outgoingCallerIds.list({ phoneNumber: credentials.fromNumber, limit: 1 }),
    ]);
    const callerUsable = numbers.some((number) => number.phoneNumber === credentials.fromNumber && number.capabilities?.voice === true) || verified.some((number) => number.phoneNumber === credentials.fromNumber);
    const active = account.status === 'active';
    return { authenticated: true, active, accountType: account.type === 'Full' ? 'Full' : 'Trial', callerUsable,
      ready: active && callerUsable,
      reason: !active ? 'Twilio account is not active.' : !callerUsable ? 'The configured caller number is not owned or verified in this Twilio account.' : null };
  } catch {
    return { authenticated: false, ready: false, reason: 'Twilio credentials or caller configuration could not be verified.' };
  }
}
