export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { system, messages, tools, mcp_servers, max_tokens = 6000 } = req.body;

  try {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens,
      messages,
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    if (mcp_servers) body.mcp_servers = mcp_servers;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "mcp-client-2025-04-04",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
