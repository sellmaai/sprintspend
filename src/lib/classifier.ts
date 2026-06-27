import Anthropic from "@anthropic-ai/sdk";

interface LinearIssue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  description?: string;
}

export interface ClassificationResult {
  issueId: string | null;
  issueIdentifier: string | null;
  confidence: "high" | "low" | "none";
}

export async function classifyConversation(
  apiKey: string,
  conversationExcerpt: string,
  issues: LinearIssue[]
): Promise<ClassificationResult> {
  if (!conversationExcerpt.trim() || issues.length === 0) {
    return { issueId: null, issueIdentifier: null, confidence: "none" };
  }

  const issueList = issues
    .map((i) => {
      const desc = i.description ? ` - ${i.description.slice(0, 100)}` : "";
      return `${i.identifier}: ${i.title}${desc}`;
    })
    .join("\n");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are classifying a developer's Claude Code conversation to determine which Linear issue they are working on.

## Active Linear Issues
${issueList}

## Conversation Excerpt
${conversationExcerpt}

## Instructions
Based on the conversation content, determine which Linear issue the developer is most likely working on. Consider:
- Code files being edited and their relation to issue descriptions
- Feature names, bug descriptions, or task references mentioned
- The general domain/area of work

Respond with ONLY a JSON object (no markdown, no explanation):
{"identifier": "ENG-123", "confidence": "high"}

Use "high" confidence if the match is clear, "low" if it's a guess.
If no issue matches, respond: {"identifier": null, "confidence": "none"}`,
      },
    ],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text.trim()) as {
      identifier: string | null;
      confidence: "high" | "low" | "none";
    };

    if (!parsed.identifier) {
      return { issueId: null, issueIdentifier: null, confidence: "none" };
    }

    const matchedIssue = issues.find(
      (i) => i.identifier === parsed.identifier
    );
    return {
      issueId: matchedIssue?.id ?? null,
      issueIdentifier: parsed.identifier,
      confidence: parsed.confidence ?? "low",
    };
  } catch {
    return { issueId: null, issueIdentifier: null, confidence: "none" };
  }
}
