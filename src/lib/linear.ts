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

// Fetch active projects the user has access to
export async function getMyProjects(
  client: LinearClient
): Promise<
  Array<{ id: string; name: string; description?: string }>
> {
  const projects = await client.projects({
    first: 50,
  });

  return projects.nodes.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description ?? undefined,
  }));
}

// Parse existing cost breakdown from a SprintSpends project update
// Format: "| @user | $12.50 |"
function parseCostBreakdown(body: string): Record<string, number> {
  const costs: Record<string, number> = {};
  const regex = /\|\s*(.+?)\s*\|\s*\$(\d+\.?\d*)\s*\|/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const name = match[1].trim();
    const cost = parseFloat(match[2]);
    if (name && !isNaN(cost) && name !== "**Total**") {
      costs[name] = cost;
    }
  }
  return costs;
}

// Build the project update body with per-user breakdown
function buildUpdateBody(costs: Record<string, number>): string {
  const total = Object.values(costs).reduce((sum, c) => sum + c, 0);
  const rows = Object.entries(costs)
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

  // Update this dev's cost
  costs[userName] = userCost;

  const body = buildUpdateBody(costs);

  if (existing) {
    await client.updateProjectUpdate(existing.id, { body });
  } else {
    await client.createProjectUpdate({ projectId, body });
  }
}
