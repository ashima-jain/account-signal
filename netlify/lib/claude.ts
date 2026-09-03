/**
 * Anthropic access, kept in one place.
 *
 * Both AI endpoints work the same way: give Claude a tool whose input schema is
 * the shape we want back, let it search the web, then read the structured
 * result out of the tool call. Nothing downstream parses prose, and nothing the
 * model returns is trusted until the domain layer has checked it.
 */

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';

export class MissingApiKey extends Error {
  readonly status = 503;
  constructor() {
    super('ANTHROPIC_API_KEY is not configured on this deployment.');
    this.name = 'MissingApiKey';
  }
}

export function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKey();
  return new Anthropic({ apiKey });
}

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
  max_uses: 8,
};

export class ModelRefusedStructure extends Error {
  readonly status = 502;
  constructor(toolName: string) {
    super(`The research model did not return a ${toolName} result. Try again.`);
    this.name = 'ModelRefusedStructure';
  }
}

interface StructuredCallOptions {
  system: string;
  prompt: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
  /** Give the model web search before it fills in the schema. */
  allowWebSearch?: boolean;
}

/**
 * Runs a prompt and returns the input of the named tool call.
 *
 * When web search is enabled the model cannot be forced to answer in one turn —
 * it has to search first — so a second turn asks for the tool explicitly if the
 * first turn ended without it.
 */
export async function structuredCall<T>({
  system,
  prompt,
  tool,
  maxTokens = 8000,
  allowWebSearch = false,
}: StructuredCallOptions): Promise<T> {
  const anthropic = client();
  const tools: Anthropic.ToolUnion[] = allowWebSearch
    ? [WEB_SEARCH_TOOL, tool]
    : [tool];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

  const first = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools,
    tool_choice: allowWebSearch ? { type: 'auto' } : { type: 'tool', name: tool.name },
    messages,
  });

  const found = toolInput<T>(first, tool.name);
  if (found) return found;

  messages.push({ role: 'assistant', content: first.content });
  messages.push({
    role: 'user',
    content: `Now call ${tool.name} with everything you found. Do not search again.`,
  });

  const second = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages,
  });

  const result = toolInput<T>(second, tool.name);
  if (!result) throw new ModelRefusedStructure(tool.name);
  return result;
}

function toolInput<T>(message: Anthropic.Message, name: string): T | null {
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === name) return block.input as T;
  }
  return null;
}
