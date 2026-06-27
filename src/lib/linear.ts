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

// Post or update a project update with the AI spend
export async function updateProjectAiSpend(
  client: LinearClient,
  projectId: string,
  totalCost: number
): Promise<void> {
  const costStr = totalCost.toFixed(2);
  const body = `**AI Spend: $${costStr}**\n\n_Tracked by SprintSpends_`;

  // Check for existing SprintSpends project update
  const project = await client.project(projectId);
  const updates = await project.projectUpdates({ first: 50 });

  const existing = updates.nodes.find((u) =>
    u.body.includes("Tracked by SprintSpends")
  );

  if (existing) {
    await client.updateProjectUpdate(existing.id, { body });
  } else {
    await client.createProjectUpdate({ projectId, body });
  }
}
