import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * The MCP server an external agent (Claude Code, Codex, OpenCode) starts to
 * reach Questlog. It holds nothing itself: every list and call goes to the
 * running app, which owns the data.
 */

const URL_ = process.env.QUESTLOG_BRIDGE_URL;
const TOKEN = process.env.QUESTLOG_BRIDGE_TOKEN;

async function post(route: string, body: unknown) {
  const res = await fetch(`${URL_}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const server = new Server({ name: 'questlog', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await post('/list', {}) }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const out = (await post('/call', { name: req.params.name, args: req.params.arguments ?? {} })) as {
      text: string;
      isError?: boolean;
      images?: { data: string; mimeType: string }[];
    };
    const images = (out.images ?? []).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }));
    return { content: [{ type: 'text', text: out.text }, ...images], isError: !!out.isError };
  } catch (e) {
    return { content: [{ type: 'text', text: `Questlog isn't reachable: ${(e as Error).message}` }], isError: true };
  }
});

void server.connect(new StdioServerTransport());
