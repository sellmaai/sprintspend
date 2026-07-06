import { LinearClient } from "@linear/sdk";

export function createLinearClient(accessToken: string): LinearClient {
  return new LinearClient({ accessToken });
}

export async function getCurrentUser(
  client: LinearClient
): Promise<{ id: string; name: string }> {
  const me = await client.viewer;
  return { id: me.id, name: me.name };
}

// Fetch active projects the user has access to (excludes completed/cancelled)
export async function getMyProjects(
  client: LinearClient
): Promise<
  Array<{ id: string; name: string; description?: string }>
> {
  const projects = await client.projects({
    first: 50,
    filter: {
      completedAt: { null: true },
      canceledAt: { null: true },
    },
  });

  return projects.nodes.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description ?? undefined,
  }));
}

// Parse existing cost breakdown from a SprintSpends project update
// Handles both new table format ("| user | $12.50 |") and old single-line format ("**AI Spend: $45.50**")
function parseCostBreakdown(body: string): Record<string, number> {
  const costs: Record<string, number> = {};
  const regex = /\|\s*(.+?)\s*\|\s*\$(\d+\.?\d*)\s*\|/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const name = match[1].trim();
    const cost = parseFloat(match[2]);
    if (name && !isNaN(cost) && name !== "**Total**" && name !== "Developer") {
      costs[name] = cost;
    }
  }

  // Fallback: parse old format that had no per-developer table
  // e.g. "**AI Spend: $45.50**"
  if (Object.keys(costs).length === 0) {
    const oldFormat = body.match(/\*\*AI Spend:\s*\$(\d+\.?\d*)\*\*/);
    if (oldFormat) {
      // Attribute old cost to "_legacy" so it's preserved in the table
      const oldCost = parseFloat(oldFormat[1]);
      if (!isNaN(oldCost) && oldCost > 0) {
        costs["_legacy"] = oldCost;
      }
    }
  }

  return costs;
}

// Build the project update body with per-user breakdown
function buildUpdateBody(costs: Record<string, number>): string {
  // Filter out zero/negative entries
  const activeCosts = Object.fromEntries(
    Object.entries(costs).filter(([, c]) => c > 0)
  );
  const total = Object.values(activeCosts).reduce((sum, c) => sum + c, 0);

  if (Object.keys(activeCosts).length === 0) {
    return `**AI Spend: $0.00**

_No active costs tracked._

_Tracked by SprintSpends_`;
  }

  const rows = Object.entries(activeCosts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => `| ${name} | $${cost.toFixed(2)} |`)
    .join("\n");

  return `**AI Spend: $${total.toFixed(2)}**

| Developer | Cost |
|-----------|------|
${rows}
| **Total** | **$${total.toFixed(2)}** |

_Tracked by SprintSpends_`;
}

// Update the project's AI spend, merging with other devs' costs
export async function updateProjectAiSpend(
  client: LinearClient,
  projectId: string,
  userCost: number
): Promise<void> {
  const me = await client.viewer;
  const userName = me.name;

  // Check for existing SprintSpends project update
  const project = await client.project(projectId);
  const updates = await project.projectUpdates({ first: 50 });

  const existing = updates.nodes.find((u) =>
    u.body.includes("Tracked by SprintSpends")
  );

  // Merge with existing costs from other devs
  let costs: Record<string, number> = {};
  if (existing) {
    costs = parseCostBreakdown(existing.body);
  }

  // Update this dev's cost (remove row if zero to keep table clean)
  if (userCost > 0) {
    costs[userName] = userCost;
  } else {
    delete costs[userName];
  }

  const body = buildUpdateBody(costs);

  if (existing) {
    await client.updateProjectUpdate(existing.id, { body });
  } else {
    await client.createProjectUpdate({ projectId, body });
  }
}
