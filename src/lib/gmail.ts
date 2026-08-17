import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import fs from "node:fs";
import path from "node:path";

const TOKEN_PATH = path.join(process.cwd(), "data", "gmail-token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

function credentialsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isGmailConfigured(): boolean {
  return credentialsConfigured() && fs.existsSync(TOKEN_PATH);
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/gmail/callback"
  );
}

function newOAuthClient(): OAuth2Client {
  if (!credentialsConfigured()) {
    throw new Error(
      "Gmail isn't configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local (see README)."
    );
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

export function getAuthUrl(): string {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function saveTokenFromCode(code: string): Promise<void> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function disconnectGmail(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

async function getAuthorizedClient(): Promise<OAuth2Client> {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "Gmail isn't connected yet, sir — authorize it from Settings first."
    );
  }
  const client = newOAuthClient();
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")) as Credentials;
  client.setCredentials(tokens);
  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });
  return client;
}

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export async function searchEmails(
  query: string,
  maxResults = 8
): Promise<EmailSummary[]> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query || undefined,
    maxResults,
  });
  const messages = list.data.messages ?? [];
  const results: EmailSummary[] = [];
  for (const m of messages) {
    if (!m.id) continue;
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    results.push({
      id: m.id,
      from: headerValue(msg.data.payload?.headers, "From"),
      subject: headerValue(msg.data.payload?.headers, "Subject"),
      date: headerValue(msg.data.payload?.headers, "Date"),
      snippet: msg.data.snippet ?? "",
    });
  }
  return results;
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
  from: string;
  subject: string;
  date: string;
  body: string;
}> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth });
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const body = extractPlainText(msg.data.payload).slice(0, 6000);
  return {
    from: headerValue(msg.data.payload?.headers, "From"),
    subject: headerValue(msg.data.payload?.headers, "Subject"),
    date: headerValue(msg.data.payload?.headers, "Date"),
    body,
  };
}

function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    body,
  ].join("\n");
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ id: string }> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth });
  const raw = buildRawMessage(params.to, params.subject, params.body);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return { id: res.data.id ?? "" };
}

export async function createDraft(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ id: string }> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth });
  const raw = buildRawMessage(params.to, params.subject, params.body);
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return { id: res.data.id ?? "" };
}
