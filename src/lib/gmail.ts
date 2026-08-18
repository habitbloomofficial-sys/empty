import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSetting } from "./settings";

const TOKEN_PATH = path.join(process.cwd(), "data", "gmail-token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

export const DEFAULT_REDIRECT_URI = "http://localhost:3000/api/gmail/callback";

/** Holds the one-time OAuth state between the auth redirect and the callback. */
export const OAUTH_STATE_COOKIE = "jarvis_gmail_oauth_state";

export function areGmailCredentialsConfigured(): boolean {
  return Boolean(getSetting("GOOGLE_CLIENT_ID") && getSetting("GOOGLE_CLIENT_SECRET"));
}

export function isGmailConfigured(): boolean {
  return areGmailCredentialsConfigured() && fs.existsSync(TOKEN_PATH);
}

export function redirectUri(): string {
  return getSetting("GOOGLE_REDIRECT_URI") || DEFAULT_REDIRECT_URI;
}

function newOAuthClient(): OAuth2Client {
  if (!areGmailCredentialsConfigured()) {
    throw new Error(
      "Gmail isn't configured yet, sir — add your Google client ID and secret in Settings."
    );
  }
  return new google.auth.OAuth2(
    getSetting("GOOGLE_CLIENT_ID"),
    getSetting("GOOGLE_CLIENT_SECRET"),
    redirectUri()
  );
}

export function newOAuthState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getAuthUrl(state: string): string {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline",
    // Force the consent screen every time. Google only issues a refresh token
    // on first consent, so a silent re-auth would hand back an access token
    // that dies in an hour with no way to renew it.
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

function writeTokens(tokens: Credentials): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function readTokens(): Credentials | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")) as Credentials;
  } catch {
    return null;
  }
}

export async function saveTokenFromCode(code: string): Promise<void> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token, so the connection would expire within the hour. " +
        "Remove JARVIS at myaccount.google.com/permissions and connect again."
    );
  }
  writeTokens(tokens);
}

export function disconnectGmail(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

async function getAuthorizedClient(): Promise<OAuth2Client> {
  const tokens = readTokens();
  if (!tokens) {
    throw new Error("Gmail isn't connected yet, sir — authorize it from Settings first.");
  }

  const client = newOAuthClient();
  client.setCredentials(tokens);

  // Access tokens last an hour; the library refreshes them for us and emits
  // this. Re-read from disk before merging so a concurrent request's refresh
  // isn't clobbered — and note Google omits refresh_token on refresh, so the
  // stored one has to be carried forward.
  client.on("tokens", (fresh) => {
    writeTokens({ ...(readTokens() ?? tokens), ...fresh });
  });

  return client;
}

/** Turn Google's API errors into something a person can act on. */
function describeGoogleError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/invalid_grant/i.test(message)) {
    return "Gmail access has been revoked or expired, sir — reconnect it in Settings.";
  }
  if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(message)) {
    return "That needs a Gmail permission I wasn't granted, sir — disconnect and reconnect Gmail in Settings, accepting all the checkboxes.";
  }
  if (/Gmail API has not been used|accessNotConfigured|SERVICE_DISABLED/i.test(message)) {
    return "The Gmail API isn't enabled on your Google Cloud project yet, sir — enable it, then try again.";
  }
  if (/invalid_client|unauthorized_client/i.test(message)) {
    return "Google rejected the client ID or secret, sir — check them in Settings.";
  }
  return message;
}

async function withGmail<T>(run: (gmail: ReturnType<typeof google.gmail>) => Promise<T>): Promise<T> {
  try {
    const auth = await getAuthorizedClient();
    return await run(google.gmail({ version: "v1", auth }));
  } catch (err) {
    throw new Error(describeGoogleError(err));
  }
}

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export async function searchEmails(query: string, maxResults = 8): Promise<EmailSummary[]> {
  return withGmail(async (gmail) => {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query || undefined,
      maxResults: Math.min(Math.max(maxResults, 1), 20),
    });

    const messages = (list.data.messages ?? []).filter((m) => m.id);

    // Fetched together rather than one after another — a search for eight
    // emails was nine sequential round trips to Google.
    return Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        return {
          id: m.id!,
          threadId: msg.data.threadId ?? "",
          from: headerValue(msg.data.payload?.headers, "From"),
          subject: headerValue(msg.data.payload?.headers, "Subject"),
          date: headerValue(msg.data.payload?.headers, "Date"),
          snippet: msg.data.snippet ?? "",
        };
      })
    );
  });
}

function decodeBody(data?: string | null): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractPlainText(
  payload: import("googleapis").gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decodeBody(payload.body.data);
  return "";
}

export async function readEmail(messageId: string): Promise<{
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}> {
  return withGmail(async (gmail) => {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    return {
      id: messageId,
      threadId: msg.data.threadId ?? "",
      from: headerValue(msg.data.payload?.headers, "From"),
      to: headerValue(msg.data.payload?.headers, "To"),
      subject: headerValue(msg.data.payload?.headers, "Subject"),
      date: headerValue(msg.data.payload?.headers, "Date"),
      body: extractPlainText(msg.data.payload).slice(0, 6000),
    };
  });
}

/**
 * Header values must be ASCII, so anything else is wrapped in RFC 2047
 * encoded-words — without this a subject containing æ, ø or å arrives as
 * mojibake. Encoded words are capped at 75 characters, so long subjects are
 * split across several and folded onto continuation lines.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;

  const words: string[] = [];
  let chunk = "";
  const flush = () => {
    if (chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf-8").toString("base64")}?=`);
      chunk = "";
    }
  };

  // Split on whole characters (not bytes) so multi-byte sequences stay intact.
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, "utf-8") > 45) flush();
    chunk += char;
  }
  flush();

  return words.join("\r\n ");
}

/**
 * Address headers are not free text: the address itself must stay literal, and
 * only a display name may be encoded. Running the whole thing through
 * encodeHeaderValue would produce `To: =?UTF-8?B?...?=` and the message would
 * never be delivered.
 */
function encodeAddressHeader(value: string): string {
  // Split on commas that separate recipients, not on commas inside a quoted
  // display name — `"Hansen, Søren" <s@x.dk>` is one address, not two.
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts
    .map((part) => {
      const trimmed = part.trim();
      const match = /^(.*?)\s*<([^>]+)>$/.exec(trimmed);
      if (!match) return trimmed; // a bare address — leave it exactly as-is

      const [, rawName, address] = match;
      const name = rawName.replace(/^"|"$/g, "").trim();
      return name ? `${encodeHeaderValue(name)} <${address}>` : `<${address}>`;
    })
    .filter(Boolean)
    .join(", ");
}

interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

function buildRawMessage(message: OutgoingMessage): string {
  const headers = [
    `To: ${encodeAddressHeader(message.to)}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (message.inReplyTo) headers.push(`In-Reply-To: ${message.inReplyTo}`);
  if (message.references) headers.push(`References: ${message.references}`);

  // CRLF line endings, as RFC 5322 requires.
  const raw = `${headers.join("\r\n")}\r\n\r\n${message.body}`;
  return Buffer.from(raw, "utf-8").toString("base64url");
}

/**
 * Gather what's needed to make a message land in an existing conversation
 * rather than starting a new one: the thread, the message being answered, and
 * a subject/recipient inherited from it when the caller didn't specify.
 */
async function replyContext(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string
): Promise<{ threadId: string; inReplyTo: string; references: string; to: string; subject: string }> {
  const original = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Message-ID", "References", "From", "Reply-To", "Subject"],
  });

  const headers = original.data.payload?.headers;
  const messageIdHeader = headerValue(headers, "Message-ID");
  const existingRefs = headerValue(headers, "References");
  const subject = headerValue(headers, "Subject");

  return {
    threadId: original.data.threadId ?? "",
    inReplyTo: messageIdHeader,
    references: [existingRefs, messageIdHeader].filter(Boolean).join(" "),
    to: headerValue(headers, "Reply-To") || headerValue(headers, "From"),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
  };
}

export interface ComposeParams {
  to?: string;
  subject?: string;
  body: string;
  /** When set, the message is threaded as a reply to this message. */
  replyToMessageId?: string;
}

async function compose(
  gmail: ReturnType<typeof google.gmail>,
  params: ComposeParams
): Promise<{ raw: string; threadId?: string; to: string; subject: string }> {
  let context: Awaited<ReturnType<typeof replyContext>> | null = null;
  if (params.replyToMessageId) {
    context = await replyContext(gmail, params.replyToMessageId);
  }

  const to = params.to?.trim() || context?.to || "";
  const subject = params.subject?.trim() || context?.subject || "";
  if (!to) {
    throw new Error("No recipient for that email, sir — who should it go to?");
  }

  return {
    raw: buildRawMessage({
      to,
      subject,
      body: params.body,
      inReplyTo: context?.inReplyTo,
      references: context?.references,
    }),
    threadId: context?.threadId || undefined,
    to,
    subject,
  };
}

export async function sendEmail(
  params: ComposeParams
): Promise<{ id: string; to: string; subject: string }> {
  return withGmail(async (gmail) => {
    const { raw, threadId, to, subject } = await compose(gmail, params);
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    });
    return { id: res.data.id ?? "", to, subject };
  });
}

export async function createDraft(
  params: ComposeParams
): Promise<{ id: string; to: string; subject: string }> {
  return withGmail(async (gmail) => {
    const { raw, threadId, to, subject } = await compose(gmail, params);
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } },
    });
    return { id: res.data.id ?? "", to, subject };
  });
}

/** The address Gmail sends as — shown in Settings to confirm the right account. */
export async function getConnectedAddress(): Promise<string> {
  return withGmail(async (gmail) => {
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? "";
  });
}
