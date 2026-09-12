import twilio from "twilio";
import { getSetting } from "./settings";
import {
  findContact,
  parseContacts,
  toDiallable,
  type Contact,
} from "./phoneNumbers";

// Placing a phone call.
//
// What this does, precisely: it rings *your* phone, and when you answer it
// dials the number you asked for and joins the two lines. You do the talking.
//
// That order matters. Calling the other party first would leave a real person
// listening to silence while your phone rings, which is how a pizza place
// decides you're a nuisance caller. Ringing you first means the line is only
// opened once there is somebody on it.
//
// What this deliberately does not do is talk to them for you. A model
// conducting a live phone call needs real-time audio in both directions, fails
// badly the moment anything unexpected is said, and in many places may not
// take part in a call without disclosing what it is. Connecting you is
// genuinely useful and honest about what it is; the other thing is a demo that
// ends with somebody's dinner order wrong.

export function isPhoneConfigured(): boolean {
  return Boolean(
    getSetting("TWILIO_ACCOUNT_SID") &&
      getSetting("TWILIO_AUTH_TOKEN") &&
      getSetting("TWILIO_VOICE_FROM") &&
      getSetting("MY_PHONE_NUMBER")
  );
}

export function savedContacts(): Contact[] {
  return parseContacts(getSetting("PHONE_CONTACTS"));
}

/**
 * A call every few seconds would be a machine misbehaving, not a person
 * making calls. One at a time, with a gap, and never a second while the first
 * could still be ringing.
 */
const CALL_COOLDOWN_MS = 60_000;
let lastCallAt = 0;

export interface CallRequest {
  /** A number, or the name of a saved contact. */
  target: string;
  /** What to call it when speaking — "the pizza place". */
  label?: string;
}

export interface CallResult {
  sid: string;
  to: string;
  label: string;
  note: string;
}

/** XML text has to be escaped, or a name with an ampersand breaks the call. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Resolve what he said into a number to dial: a saved contact by name, or a
 * number he read out. Contacts win, since a name is unambiguous and a
 * misheard digit is not.
 */
export function resolveTarget(target: string): { number: string; label: string } {
  const contacts = savedContacts();
  const contact = findContact(contacts, target);

  const raw = contact ? contact.number : target;
  const verdict = toDiallable(raw, getSetting("PHONE_COUNTRY_CODE"));
  if (!verdict.ok || !verdict.number) {
    throw new Error(verdict.message ?? "That isn't a number I can call, sir.");
  }

  return { number: verdict.number, label: contact ? contact.name : verdict.number };
}

export async function placeCall(request: CallRequest): Promise<CallResult> {
  const sid = getSetting("TWILIO_ACCOUNT_SID");
  const token = getSetting("TWILIO_AUTH_TOKEN");
  const from = getSetting("TWILIO_VOICE_FROM");
  const mine = getSetting("MY_PHONE_NUMBER");

  if (!sid || !token || !from || !mine) {
    throw new Error(
      "Calling isn't set up yet, sir — add your Twilio voice number and your own number in Settings."
    );
  }

  const since = Date.now() - lastCallAt;
  if (since < CALL_COOLDOWN_MS) {
    const wait = Math.ceil((CALL_COOLDOWN_MS - since) / 1000);
    throw new Error(
      `I placed a call less than a minute ago, sir — give it ${wait} seconds before the next one.`
    );
  }

  const { number, label: resolved } = resolveTarget(request.target);
  const label = request.label?.trim() || resolved;

  // Your own number goes through the same checks as any other: a typo in
  // Settings should fail here rather than at Twilio.
  const me = toDiallable(mine, getSetting("PHONE_COUNTRY_CODE"));
  if (!me.ok || !me.number) {
    throw new Error(`Your own number in Settings isn't diallable: ${me.message}`);
  }
  if (me.number === number) {
    throw new Error("That's your own number, sir. I'd only be ringing you to talk to yourself.");
  }

  // Inline TwiML rather than a webhook: this runs on your computer, which has
  // no address Twilio could call back to.
  const twiml =
    `<Response>` +
    `<Say voice="Polly.Brian">Connecting you to ${escapeXml(label)}. One moment.</Say>` +
    `<Dial callerId="${escapeXml(from)}" timeout="30">${escapeXml(number)}</Dial>` +
    `</Response>`;

  const client = twilio(sid, token);
  const call = await client.calls.create({ to: me.number, from, twiml });

  lastCallAt = Date.now();

  return {
    sid: call.sid,
    to: number,
    label,
    note: `Ringing your phone now — answer it and I'll connect you to ${label}.`,
  };
}

/** About two minutes of speech. Longer than this and he stops listening. */
export const MAX_SPOKEN_UPDATE = 1200;

export interface UpdateCallResult {
  sid: string;
  to: string;
  spoken: string;
  note: string;
}

/**
 * Ring his phone and read something out.
 *
 * Different from placeCall in the one way that matters: nothing is dialled
 * afterwards. The call exists to say a thing and hang up, which is what "call
 * me if I need a live update" means — he is away from the screen and wants the
 * answer in his ear rather than a notification he will see in an hour.
 *
 * Said twice, with a pause first. The opening second of an automated call is
 * always lost to getting the phone to your ear, and a figure heard once and
 * missed is worse than useless: he would ring back to ask, which is the thing
 * this was meant to save.
 */
export async function callWithUpdate(message: string): Promise<UpdateCallResult> {
  // What is being said is checked BEFORE whether the phone is set up. An empty
  // update is a mistake in the call either way, and "there is nothing to tell
  // you" is the true answer to it — telling him to go and configure Twilio
  // would send him off to fix something that was never the problem.
  const spoken = message.trim();
  if (!spoken) throw new Error("There's nothing to tell you, sir.");
  if (spoken.length > MAX_SPOKEN_UPDATE) {
    throw new Error(
      `That's ${spoken.length} characters, sir — more than anyone takes in over the telephone. ` +
        `Give me the short version, under ${MAX_SPOKEN_UPDATE}.`
    );
  }

  const sid = getSetting("TWILIO_ACCOUNT_SID");
  const token = getSetting("TWILIO_AUTH_TOKEN");
  const from = getSetting("TWILIO_VOICE_FROM");
  const mine = getSetting("MY_PHONE_NUMBER");

  if (!sid || !token || !from || !mine) {
    throw new Error(
      "Calling isn't set up yet, sir — add your Twilio voice number and your own number in Settings."
    );
  }

  const since = Date.now() - lastCallAt;
  if (since < CALL_COOLDOWN_MS) {
    const wait = Math.ceil((CALL_COOLDOWN_MS - since) / 1000);
    throw new Error(
      `I rang you less than a minute ago, sir — give it ${wait} seconds before the next one.`
    );
  }

  const me = toDiallable(mine, getSetting("PHONE_COUNTRY_CODE"));
  if (!me.ok || !me.number) {
    throw new Error(`Your own number in Settings isn't diallable: ${me.message}`);
  }

  const said = escapeXml(spoken);
  const twiml =
    `<Response>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Brian">Good day, sir. Jarvis here, with an update.</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Brian">${said}</Say>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Brian">Once more, sir.</Say>` +
    `<Say voice="Polly.Brian">${said}</Say>` +
    `<Say voice="Polly.Brian">That is all. Good day.</Say>` +
    `</Response>`;

  const client = twilio(sid, token);
  const call = await client.calls.create({ to: me.number, from, twiml });
  lastCallAt = Date.now();

  return {
    sid: call.sid,
    to: me.number,
    spoken,
    note: `Ringing you now, sir — I'll read it out twice.`,
  };
}
