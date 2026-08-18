import type OpenAI from "openai";
import {
  searchEmails,
  readEmail,
  sendEmail,
  createDraft,
  isGmailConfigured,
  type ComposeParams,
} from "./gmail";
import { sendWhatsAppMessage, isWhatsAppConfigured } from "./whatsapp";
import { openSpotify, isDesktopControlEnabled } from "./desktop";
import type { ActionLogEntry } from "./types";

const GMAIL_TOOLS = new Set([
  "search_emails",
  "read_email",
  "send_email",
  "create_email_draft",
]);

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_emails",
      description:
        "Search the user's Gmail inbox. Use Gmail search syntax (e.g. 'from:boss@company.com', 'is:unread', 'subject:invoice'). Returns a short list of matching emails with id, sender, subject, date and a snippet.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query. Empty string returns the most recent emails.",
          },
          max_results: {
            type: "number",
            description: "Maximum number of emails to return (default 8, max 20).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_email",
      description: "Fetch the full body of a single email by its message id (from search_emails).",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "The Gmail message id." },
        },
        required: ["message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Send an email immediately on the user's behalf. Only call this once the exact recipient, subject, and body have been dictated or clearly approved by the user. To reply to an email, pass reply_to_message_id and omit 'to' and 'subject' — they're inherited from the original so the reply stays in the same conversation.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient email address. Optional when replying — defaults to the original sender.",
          },
          subject: {
            type: "string",
            description: "Optional when replying — defaults to 'Re: <original subject>'.",
          },
          body: { type: "string", description: "Plain text email body." },
          reply_to_message_id: {
            type: "string",
            description:
              "Message id (from search_emails or read_email) this is a reply to. Threads the reply into the existing conversation.",
          },
        },
        required: ["body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_email_draft",
      description:
        "Create a draft email in Gmail without sending it, so the user can review it first. Supports replies the same way send_email does.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Optional when replying." },
          subject: { type: "string", description: "Optional when replying." },
          body: { type: "string" },
          reply_to_message_id: {
            type: "string",
            description: "Message id this draft replies to, to keep it in the same thread.",
          },
        },
        required: ["body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description:
        "Send a WhatsApp message on the user's behalf via Twilio. Only call this once the exact message text has been dictated or clearly approved by the user.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient phone number in E.164 format (e.g. +14155551234). If omitted, sends to the configured default recipient.",
          },
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_spotify",
      description:
        "Open the Spotify desktop app on the user's computer, optionally landing on a search for an artist, album, song, or playlist. Use this whenever the user asks to open Spotify or put music on. This opens the app and shows results — it does not press play, so say so.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional artist, album, song, or playlist to search for once Spotify opens. Omit to just open the app.",
          },
        },
        required: [],
      },
    },
  },
];

/**
 * Only the tools that can actually do something. Offering Gmail tools with no
 * Gmail connected doesn't just waste prompt tokens — the model tries one, it
 * fails, and answering costs two more round trips before the user hears
 * anything.
 */
export function availableTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const gmail = isGmailConfigured();
  const whatsapp = isWhatsAppConfigured();

  return toolDefinitions.filter((tool) => {
    const name = tool.type === "function" ? tool.function.name : "";
    if (GMAIL_TOOLS.has(name)) return gmail;
    if (name === "send_whatsapp_message") return whatsapp;
    if (name === "open_spotify") return isDesktopControlEnabled();
    return true;
  });
}

// Tool arguments are snake_case for the model's benefit; the Gmail client
// takes camelCase.
function toComposeParams(args: {
  to?: string;
  subject?: string;
  body?: string;
  reply_to_message_id?: string;
}): ComposeParams {
  return {
    to: args.to,
    subject: args.subject,
    body: args.body ?? "",
    replyToMessageId: args.reply_to_message_id,
  };
}

export async function executeTool(
  name: string,
  rawArgs: string
): Promise<{ result: unknown; log: ActionLogEntry }> {
  const args = rawArgs ? JSON.parse(rawArgs) : {};
  try {
    switch (name) {
      case "search_emails": {
        const results = await searchEmails(args.query ?? "", args.max_results ?? 8);
        return {
          result: results,
          log: { tool: name, summary: `Searched emails for "${args.query || "recent"}" — ${results.length} found`, ok: true },
        };
      }
      case "read_email": {
        const result = await readEmail(args.message_id);
        return {
          result,
          log: { tool: name, summary: `Read email: ${result.subject}`, ok: true },
        };
      }
      case "send_email": {
        const result = await sendEmail(toComposeParams(args));
        return {
          result,
          log: {
            tool: name,
            summary: `Sent email to ${result.to}: "${result.subject}"`,
            ok: true,
          },
        };
      }
      case "create_email_draft": {
        const result = await createDraft(toComposeParams(args));
        return {
          result,
          log: {
            tool: name,
            summary: `Drafted email to ${result.to}: "${result.subject}"`,
            ok: true,
          },
        };
      }
      case "open_spotify": {
        const result = await openSpotify(args.query);
        return {
          result,
          log: {
            tool: name,
            summary: args.query ? `Opened Spotify — searched "${args.query}"` : "Opened Spotify",
            ok: true,
          },
        };
      }
      case "send_whatsapp_message": {
        const result = await sendWhatsAppMessage(args);
        return {
          result,
          log: { tool: name, summary: `Sent WhatsApp message${args.to ? ` to ${args.to}` : ""}`, ok: true },
        };
      }
      default:
        return {
          result: { error: `Unknown tool ${name}` },
          log: { tool: name, summary: `Unknown tool ${name}`, ok: false },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: { error: message },
      log: { tool: name, summary: message, ok: false },
    };
  }
}
