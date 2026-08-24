import type OpenAI from "openai";

// One conversation turn, whoever is thinking.
//
// Axis has always talked to his brain in OpenAI's chat-completions shape,
// because OpenAI, Gemini and OpenRouter all speak it. Anthropic does not: the
// Messages API has its own request shape, its own streaming events, and its own
// way of carrying a tool call. Bending it through an OpenAI-compatible shim
// would work right up until it didn't — and the failure would land in the one
// place worth protecting, the tool loop that opens things on his computer.
//
// So the tool loop is written once, against this interface, and each brain
// implements it in its own native terms.

/** A tool call, reassembled and ready to run. */
export interface BrainToolCall {
  id: string;
  name: string;
  /** JSON, as the model wrote it. */
  args: string;
}

export interface BrainReply {
  content: string;
  calls: BrainToolCall[];
}

export interface Brain {
  /**
   * Think, streaming any words as they arrive, and come back with what was
   * said and what was asked for.
   */
  turn(onText: (delta: string) => void): Promise<BrainReply>;

  /**
   * Put a completed round of tool calls into the conversation, so the next
   * turn can see what came of them. `results` lines up with `calls`.
   */
  record(reply: BrainReply, results: string[]): void;
}

/** What every brain is handed to start a conversation. */
export interface BrainInput {
  /** The whole prompt, for brains that take one string. */
  system: string;
  /**
   * The same prompt split at the point where it stops being identical between
   * requests. Anthropic bills a cached prefix at a tenth of the rate, and the
   * saving is roughly eightfold on a short exchange — see systemPrompt.ts.
   */
  parts?: { stable: string; volatile: string };
  messages: { role: "user" | "assistant"; content: string }[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}
