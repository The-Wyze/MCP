import {
  MCP_ENDPOINT,
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_VERSION,
} from "@ui/lib/mcp/serverInfo";
import { SITE_NAME, SITE_URL } from "@ui/lib/site";
import { cleanWordPressHtml } from "@ui/lib/wp-html";
import {
  blogOnlyWhere,
  getPost,
  isBlogPost,
  isValidSlug,
  normaliseSlug,
  wpFetch,
} from "@ui/lib/wordpress";
import {
  type BlogPostsQuery,
  BlogPostsDocument,
  OrderEnum,
  PostObjectsConnectionOrderbyEnum,
} from "@ui/types/blog";
import url from "@ui/utils/url";
import { unstable_cache } from "next/cache";

import { hostKind, notFoundResponse } from "../_lib/host";

// Public, read-only MCP server for the blog (the same data as /api/rss). Streamable HTTP
// transport, stateless, JSON responses only (no SSE, no sessions): POST one JSON-RPC message,
// get one back. Owner rule as everywhere public: only Blog-only posts (category 3 and nothing
// else). Listings go through blogOnlyWhere; a single post is checked with isBlogPost, so Help,
// What's new and Glossary posts are "not found" here exactly as /blog/[slug] 404s them.
// Main host only. Rate limiting belongs in a Cloudflare rule on /api/mcp, as for /api/blog.

export const dynamic = "force-dynamic";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY_BYTES = 8 * 1024;
const TTL_SECONDS = 300;
const MAX_LIMIT = 20;
const MAX_SEARCH_LENGTH = 100;

type Json = Record<string, unknown>;
type RpcId = string | number | null;

class ToolInputError extends Error {}

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** WordPress HTML as plain text an assistant can read (links stay as "text (url)"). */
function htmlToText(html: string | null | undefined): string {
  return cleanWordPressHtml(html)
    .replace(
      /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, text: string) => {
        const absolute = href.startsWith("/") ? `${SITE_URL}${href}` : href;
        return `${text} (${absolute})`;
      },
    )
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const postUrl = (slug: string | null | undefined) =>
  `${SITE_URL}${url.blog(`/${slug ?? ""}`)}`;

// ---------------------------------------------------------------------------------------
// Data (cached; wpFetch throws on failure, so failures are never cached)

const listPosts = unstable_cache(
  async (
    search: string,
    first: number,
    after: string | null,
  ): Promise<BlogPostsQuery> =>
    wpFetch<BlogPostsQuery>(
      BlogPostsDocument,
      {
        first,
        after,
        where: {
          search,
          ...(await blogOnlyWhere()),
          orderby: [
            {
              field: PostObjectsConnectionOrderbyEnum.Date,
              order: OrderEnum.Desc,
            },
          ],
        },
      },
      { revalidate: TTL_SECONDS },
    ),
  ["api-mcp-list"],
  { revalidate: TTL_SECONDS, tags: ["wordpress", "wp:posts"] },
);

// ---------------------------------------------------------------------------------------
// Tools

const TOOLS = [
  {
    name: "list_blog_posts",
    title: "List blog posts",
    description: `Lists ${SITE_NAME} blog posts, newest first, with title, date, author, excerpt and URL. Optionally filter by a search term. Use get_blog_post with a slug for the full article.`,
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Search term matched against post title and content.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: "Posts to return (default 10).",
        },
        cursor: {
          type: "string",
          description: "nextCursor from a previous call, for the next page.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_blog_post",
    title: "Get blog post",
    description: `Returns one ${SITE_NAME} blog post in full (plain text) by its slug.`,
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The post slug, e.g. from list_blog_posts.",
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

async function listBlogPosts(args: Json): Promise<Json> {
  for (const key of Object.keys(args))
    if (!["search", "limit", "cursor"].includes(key))
      throw new ToolInputError(`${key} is not allowed`);
  const { search = "", limit = 10, cursor = null } = args;
  if (typeof search !== "string")
    throw new ToolInputError("search must be a string");
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  )
    throw new ToolInputError(`limit must be an integer 1-${MAX_LIMIT}`);
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 200))
    throw new ToolInputError("cursor must be a string");

  const term = Array.from(search.trim()).slice(0, MAX_SEARCH_LENGTH).join("");
  const data = await listPosts(term, limit, cursor);
  const posts = (data.posts?.edges ?? []).flatMap((edge) => {
    const post = edge?.node;
    if (!post) return [];
    const author = [post.author?.node?.firstName, post.author?.node?.lastName]
      .filter(Boolean)
      .join(" ");
    return [
      {
        slug: post.slug,
        title: post.title,
        date: post.date,
        author: author || null,
        excerpt: htmlToText(post.excerpt),
        url: postUrl(post.slug),
        image: post.featuredImage?.node?.sourceUrl ?? null,
      },
    ];
  });
  const pageInfo = data.posts?.pageInfo;
  return {
    posts,
    nextCursor: pageInfo?.hasNextPage ? (pageInfo.endCursor ?? null) : null,
  };
}

async function getBlogPost(args: Json): Promise<Json | null> {
  for (const key of Object.keys(args))
    if (key !== "slug") throw new ToolInputError(`${key} is not allowed`);
  if (typeof args.slug !== "string")
    throw new ToolInputError("slug is required");
  const slug = normaliseSlug(
    args.slug
      .trim()
      .replace(/^.*\/blog\//, "")
      .replace(/\/+$/, ""),
  );
  if (!isValidSlug(slug))
    throw new ToolInputError("slug is not a valid post slug");

  const post = await getPost(slug);
  if (
    !post ||
    !isBlogPost(
      (post.categories?.nodes ?? []).map((category) => category?.databaseId),
    )
  )
    return null;
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    modified: post.modified,
    author: post.author?.node?.name ?? null,
    readingTime: post.seo?.readingTime ?? null,
    description: post.seo?.metaDesc || htmlToText(post.excerpt),
    url: postUrl(post.slug),
    image: post.featuredImage?.node?.sourceUrl ?? null,
    content: htmlToText(post.content),
    faqs: (post.faqs?.faqs ?? []).flatMap((faq) =>
      faq ? [{ question: faq.title, answer: htmlToText(faq.description) }] : [],
    ),
  };
}

const toolResult = (value: unknown, isError = false) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
  ...(isError ? { isError: true } : { structuredContent: value }),
});

async function callTool(params: Json): Promise<Json> {
  const args = params.arguments ?? {};
  if (!isRecord(args)) return toolResult("arguments must be an object", true);
  try {
    switch (params.name) {
      case "list_blog_posts":
        return toolResult(await listBlogPosts(args));
      case "get_blog_post": {
        const post = await getBlogPost(args);
        return post
          ? toolResult(post)
          : toolResult("No blog post with that slug.", true);
      }
      default:
        throw new RpcError(-32602, `Unknown tool: ${String(params.name)}`);
    }
  } catch (error) {
    if (error instanceof ToolInputError)
      return toolResult(`Invalid arguments: ${error.message}`, true);
    if (error instanceof RpcError) throw error;
    console.error(`[api/mcp] ${String(params.name)} failed`, error);
    return toolResult(
      "The blog is temporarily unavailable. Try again shortly.",
      true,
    );
  }
}

// ---------------------------------------------------------------------------------------
// JSON-RPC

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle(method: string, params: Json): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : "";
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "thewyze-blog",
          title: `${SITE_NAME} Blog`,
          version: MCP_SERVER_VERSION,
        },
        instructions: `Read-only access to the public ${SITE_NAME} blog (${SITE_URL}${url.blog("")}): guaranteed rent, temporary accommodation and property management articles for UK letting agents. Cite post URLs when using them.`,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(params);
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

const rpcError = (id: RpcId, code: number, message: string, status = 200) =>
  Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: NO_STORE },
  );

const NO_STORE = { "Cache-Control": "no-store" };

// Open CORS (never credentials): public blog data, and browser-based MCP clients need the preflight.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  for (const [name, value] of Object.entries(CORS_HEADERS))
    response.headers.set(name, value);
  return response;
}

export async function POST(request: Request): Promise<Response> {
  return withCors(await respond(request));
}

async function respond(request: Request): Promise<Response> {
  if (hostKind(request).kind !== "main") return notFoundResponse();
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES)
    return rpcError(null, -32600, "Request too large", 413);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return rpcError(null, -32600, "Request too large", 413);

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (
    !isRecord(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  )
    return rpcError(
      null,
      -32600,
      "Invalid request (batches are not supported)",
      400,
    );

  // Notifications (no id), e.g. notifications/initialized: accepted, no body.
  if (!("id" in message))
    return new Response(null, { status: 202, headers: NO_STORE });

  const id = message.id as RpcId;
  const params = isRecord(message.params) ? message.params : {};
  try {
    const result = await handle(message.method, params);
    return Response.json({ jsonrpc: "2.0", id, result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RpcError)
      return rpcError(id, error.code, error.message);
    console.error("[api/mcp] request failed", error);
    return rpcError(id, -32603, "Internal error");
  }
}

// GET: an MCP client opening the SSE stream gets 405 (stateless, none offered); anything else
// is a probe and is told what this is. DELETE: no session to end.
export function GET(request: Request): Response {
  if (hostKind(request).kind !== "main") return notFoundResponse();
  if (request.headers.get("accept")?.includes("text/event-stream"))
    return withCors(
      new Response("This server offers no SSE stream; POST to it.", {
        status: 405,
        headers: { Allow: "POST", ...NO_STORE },
      }),
    );
  return withCors(
    Response.json(
      {
        name: "thewyze-blog",
        version: MCP_SERVER_VERSION,
        description: MCP_SERVER_DESCRIPTION,
        transport: "streamable-http",
        endpoint: MCP_ENDPOINT,
        method: "POST",
        authentication: { required: false },
        tools: TOOLS.map((tool) => tool.name),
      },
      { headers: { "Cache-Control": "public, max-age=300" } },
    ),
  );
}

export const DELETE = (): Response =>
  withCors(
    new Response(null, {
      status: 405,
      headers: { Allow: "POST", ...NO_STORE },
    }),
  );

export const OPTIONS = (): Response =>
  withCors(new Response(null, { status: 204 }));
