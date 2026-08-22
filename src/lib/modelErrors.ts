// Turning a provider's refusal into a sentence.
//
// Extracted from the chat route so it can be tested directly: these messages
// are the only thing the user ever sees when the model won't answer, and every
// one of them is a claim about what is wrong and what to do about it. Getting
// one of those wrong sends someone off regenerating a perfectly good key.

/**
 * Model failures reach the user, so they have to say something. The SDK's own
 * wording for a rejected request is "400 status code (no body)", which tells
 * nobody anything.
 */
export function describeModelFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number })?.status;

  if (status === 401 || status === 403 || /api[_ ]key/i.test(message)) {
    return "The AI provider refused my key, sir — check it in Settings.";
  }
  if (status === 429 || /quota|rate.?limit|RateLimitReached/i.test(message)) {
    return "The AI provider is rate limiting me, sir — a moment and try again.";
  }
  // 410 Gone is a service saying it no longer exists — not a bad key, and not
  // something waiting will fix. GitHub Models answered exactly this after it
  // was retired, and the word "brownout" in its message made it read like an
  // outage that would pass.
  if (status === 410 || /retirement|retired|brownout|no longer available/i.test(message)) {
    return "That AI service has been shut down, sir — it isn't your key. Pick a different provider in Settings.";
  }
  if (status === 400 && /no body/i.test(message)) {
    return "The AI provider rejected the request, sir, without saying why. Worth a retry, or check the model name in Settings.";
  }
  // Anthropic's out-of-credit answer is a 400, not a 402, and its message is
  // the only thing distinguishing it from a malformed request.
  if (/credit balance is too low|billing|purchase credits/i.test(message)) {
    return "Your Anthropic account is out of credit, sir — top it up at console.anthropic.com and I'll pick straight back up.";
  }
  if (status === 402 || /more credits|can only afford/i.test(message)) {
    return "Your OpenRouter balance won't cover a reply, sir — add credit at openrouter.ai/settings/credits, or pick a cheaper model in Settings.";
  }
  if (status && status >= 500) {
    return "The AI provider is having trouble at their end, sir — try again shortly.";
  }
  return message;
}
