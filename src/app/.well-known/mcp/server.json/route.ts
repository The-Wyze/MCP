import { MCP_SERVER_CARD } from "@ui/lib/mcp/serverInfo";

import { hostKind, notFoundResponse } from "../../../api/_lib/host";

// MCP server card: what the official MCP Registry and client directories read to describe the
// blog MCP server (/api/mcp). Main host only: a portal is not this server and must not claim it.

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (hostKind(request).kind !== "main") return notFoundResponse();
  return Response.json(MCP_SERVER_CARD, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
