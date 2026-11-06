# Changelog

Versions match the `version` the server reports in its handshake and on its
[registry card](https://thewyze.com/.well-known/mcp/server.json).

## 1.0.0 — 2026-11

- Two public, read-only tools: `list_blog_posts` (newest first, optional search, cursor paging, up to 20 a call) and
  `get_blog_post` (one post in full as plain text, with its description, reading time and FAQs).
- Blog posts only: help-centre, what's-new and glossary posts are not served.
- Streamable HTTP, stateless, JSON responses, no login. A GET on the endpoint describes the server.
- Listed in the official MCP Registry as `com.thewyze/blog`.
