import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TOPICS, openingForTopic, permissionMessages, GOODBYE } from './conversation-policy.mjs';

// Every sentence the carrier plays before Live takes over, pre-recorded with the Live
// voice (scripts/render-voice-prompts.mjs) so the caller hears one voice throughout.
export function requiredPromptTexts() {
  const texts = new Set([GOODBYE]);
  for (const topicId of Object.keys(TOPICS)) {
    texts.add(openingForTopic(topicId));
    for (const message of permissionMessages(topicId)) texts.add(message);
  }
  return [...texts];
}

// The file name follows the text, so a wording change needs a new recording and busts Twilio's cache.
export const promptFile = (text) => `${createHash('sha256').update(text).digest('hex').slice(0, 16)}.wav`;

export const DEFAULT_PROMPT_DIR = new URL('../voice/', import.meta.url);

// Fails closed: without a recording for every sentence the carrier would need a second voice.
export function loadVoicePrompts(dir = DEFAULT_PROMPT_DIR) {
  const prompts = new Map();
  const missing = [];
  for (const text of requiredPromptTexts()) {
    const file = promptFile(text);
    try { prompts.set(text, { file, data: readFileSync(new URL(file, dir)) }); } catch { missing.push(file); }
  }
  if (missing.length) throw new Error(`Missing voice recordings: ${missing.join(', ')}. Run scripts/render-voice-prompts.mjs.`);
  return prompts;
}

// RIFF/WAVE header for 8 kHz mono G.711 μ-law, the format Live produces for telephony.
export function mulawWav(audio) {
  const samples = audio.subarray(0, audio.length - (audio.length % 2)); // RIFF chunks are word-aligned.
  const header = Buffer.alloc(58);
  header.write('RIFF', 0); header.writeUInt32LE(50 + samples.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(18, 16); header.writeUInt16LE(7, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.writeUInt16LE(0, 36);
  header.write('fact', 38); header.writeUInt32LE(4, 42); header.writeUInt32LE(samples.length, 46);
  header.write('data', 50); header.writeUInt32LE(samples.length, 54);
  return Buffer.concat([header, samples]);
}
