import { z } from 'zod';
import { desktop, type ToolImage } from '@/lib/desktop';
import { buildTools, type ToolHost } from './tools';

/**
 * In the desktop app, hand Offerdex's tools to an external agent (Claude Code,
 * Codex, OpenCode). The agent sees them through an MCP server; each call
 * lands here and runs against this window's data, so the pages update live
 * exactly as they do for the built-in agent.
 */
export function serveTools(host: ToolHost) {
  const d = desktop();
  if (!d) return () => {};
  return d.serveTools({
    async list() {
      const tools = buildTools(host);
      return Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema ? z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' }) : { type: 'object', properties: {} },
      }));
    },
    async call(name, args) {
      // Coding agents can look at pictures, so tools like preview_document can hand them one.
      const images: ToolImage[] = [];
      const tool = buildTools({ ...host, attachImage: (i) => images.push(i) })[name];
      if (!tool) return { text: `No tool ${name}.`, isError: true };
      const r = await tool.execute(args ?? {});
      return { text: r.content, isError: r.isError, images };
    },
  });
}
