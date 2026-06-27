import { LinearClient } from "@linear/sdk";

const COMMENT_TAG = "<!-- sprintspends -->";

export function createLinearClient(accessToken: string): LinearClient {
  return new LinearClient({ accessToken });
}

export async function getCurrentUser(
  client: LinearClient
): Promise<{ id: string; name: string }> {
  const me = await client.viewer;
  return { id: me.id, name: me.name };
}

// Fetch active/in-progress issues assigned to the current user
export async function getMyActiveIssues(
  client: LinearClient
): Promise<
  Array<{ id: string; identifier: string; title: string; description?: string }>
> {
  const me = await client.viewer;
  const issues = await me.assignedIssues({
    filter: {
      state: {
        type: { in: ["started", "unstarted"] },
      },
    },
    first: 50,
  });

  return issues.nodes.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
  }));
}

// Find existing SprintSpends comment on an issue
async function findSprintSpendsComment(
  client: LinearClient,
  issueId: string
): Promise<{ id: string; body: string } | null> {
  const issue = await client.issue(issueId);
  const comments = await issue.comments({ first: 100 });

  for (const comment of comments.nodes) {
    if (comment.body.includes(COMMENT_TAG)) {
      return { id: comment.id, body: comment.body };
    }
  }
  return null;
}

// Update or create AI Spend comment on an issue
export async function updateIssueAiSpend(
  client: LinearClient,
  issueId: string,
  totalCost: number
): Promise<void> {
  const costStr = totalCost.toFixed(2);
  const body = `${COMMENT_TAG}\n**AI Spend: $${costStr}**\n\n_Tracked by SprintSpends_`;

  const existing = await findSprintSpendsComment(client, issueId);

  if (existing) {
    await client.updateComment(existing.id, { body });
  } else {
    await client.createComment({ issueId, body });
  }
}
