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

// Find or create the "AI Spend ($)" custom field
export async function findOrCreateCustomField(
  client: LinearClient
): Promise<string> {
  // Search for existing custom field
  const response = await client.client.rawRequest(
    `query { customFields { nodes { id name } } }`
  );
  const fields = (response.data as any).customFields.nodes as Array<{
    id: string;
    name: string;
  }>;

  const existing = fields.find((f) => f.name === "AI Spend ($)");
  if (existing) return existing.id;

  // Create the custom field
  const createResponse = await client.client.rawRequest(
    `mutation($input: CustomFieldCreateInput!) {
      customFieldCreate(input: $input) {
        customField { id name }
        success
      }
    }`,
    {
      input: {
        name: "AI Spend ($)",
        type: "number",
        description: "Cumulative AI tool cost tracked by SprintSpends",
      },
    }
  );

  const created = (createResponse.data as any).customFieldCreate.customField;
  return created.id;
}

// Read current AI Spend value from an issue
export async function getIssueAiSpend(
  client: LinearClient,
  issueId: string,
  customFieldId: string
): Promise<number> {
  const response = await client.client.rawRequest(
    `query($id: String!) {
      issue(id: $id) {
        customFields {
          edges {
            value
            customField { id }
          }
        }
      }
    }`,
    { id: issueId }
  );

  const edges = (response.data as any)?.issue?.customFields?.edges as
    | Array<{ value: any; customField: { id: string } }>
    | undefined;

  if (!edges) return 0;

  const field = edges.find((e) => e.customField.id === customFieldId);
  return typeof field?.value === "number" ? field.value : 0;
}

// Update the AI Spend custom field on an issue (additive)
export async function updateIssueAiSpend(
  client: LinearClient,
  issueId: string,
  customFieldId: string,
  costDelta: number
): Promise<void> {
  const currentCost = await getIssueAiSpend(client, issueId, customFieldId);
  const newCost = Math.round((currentCost + costDelta) * 100) / 100;

  await client.client.rawRequest(
    `mutation($issueId: String!, $value: CustomFieldValue!) {
      issueCustomFieldValueUpdate(id: $issueId, value: $value) {
        success
      }
    }`,
    {
      issueId,
      value: {
        customFieldId,
        value: newCost,
      },
    }
  );
}
