import { SITE_NAME, SITE_URL } from "@ui/lib/site";

// One source for the public blog MCP server's identity (route handshake, GET probe, server card).
// The MCP repo (theWyze/MCP) mirrors MCP_SERVER_VERSION in its manifests: bump it with
// MCP/scripts/release.sh, never by hand in one place only.

export const MCP_SERVER_VERSION = "1.0.0";

/** Reverse-DNS registry namespace; must match the key at /.well-known/mcp-registry-auth. */
export const MCP_REGISTRY_NAME = "com.thewyze/blog";

export const MCP_ENDPOINT = `${SITE_URL}/api/mcp`;

export const MCP_SERVER_DESCRIPTION = `${SITE_NAME} blog: guaranteed rent, temporary accommodation and property management articles for UK letting agents.`;

/** The registry's server.json schema; bump with the mcp-publisher version in MCP/.github/workflows/publish.yml. */
export const MCP_SERVER_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

export const MCP_REPOSITORY = "https://github.com/The-Wyze/MCP";

export const MCP_SERVER_CARD = {
  $schema: MCP_SERVER_SCHEMA,
  name: MCP_REGISTRY_NAME,
  title: `${SITE_NAME} Blog`,
  description: MCP_SERVER_DESCRIPTION,
  version: MCP_SERVER_VERSION,
  websiteUrl: SITE_URL,
  repository: { url: MCP_REPOSITORY, source: "github" },
  icons: [
    {
      src: `${SITE_URL}/static/favicon/web-app-manifest-192x192.png`,
      mimeType: "image/png",
      sizes: ["192x192"],
    },
    {
      src: `${SITE_URL}/static/favicon/web-app-manifest-512x512.png`,
      mimeType: "image/png",
      sizes: ["512x512"],
    },
  ],
  remotes: [{ type: "streamable-http", url: MCP_ENDPOINT }],
} as const;
