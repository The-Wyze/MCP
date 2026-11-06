# Releasing a new version

The server's version lives in one place, `MCP_SERVER_VERSION` in the app (`Front-End/src/lib/mcp/serverInfo.ts`); the
handshake, the GET probe and the server card all read it. This repo mirrors it in `server.json`, `plugin.json` and
`gemini-extension.json`, and the official MCP Registry lists whichever version was last published. One script and
one workflow keep the four in step.

## Once: give the workflow the namespace key

The registry accepts a new version of `com.thewyze/blog` only from whoever holds the Ed25519 key behind
`https://thewyze.com/.well-known/mcp-registry-auth` (HTTP namespace verification). Put the hex private key in a
repository secret:

```bash
gh secret set MCP_REGISTRY_PRIVATE_KEY -R The-Wyze/MCP < path/to/private-key.hex
```

Cloudflare must let `/api/mcp`, `/.well-known/mcp/server.json` and `/.well-known/mcp-registry-auth` through without a
browser challenge, or neither AI clients nor the workflow can reach them.

## Each release

1. **Cut it from this repo.** With the app checked out beside this one (`../Front-End`, or set `WYZE_APP`):

   ```bash
   scripts/release.sh patch        # or minor, major, or an exact X.Y.Z; no argument keeps the app's version
   ```

   It bumps `MCP_SERVER_VERSION` in the app and type-checks it, syncs `src/` here, writes the version into the three
   manifests, insists on a `## X.Y.Z` section in `CHANGELOG.md` (it writes a stub and stops if there is none), then
   commits `Release vX.Y.Z`, tags `vX.Y.Z` and pushes. `--dry-run` shows the plan and touches nothing.

2. **Deploy the app.** Commit the `serverInfo.ts` bump in Front-End and deploy it. Before or after step 1, either
   order works.

3. **Let the workflow finish.** The tag starts [`publish.yml`](.github/workflows/publish.yml), which waits up to
   30 minutes for the live server card and GET probe to report the new version, publishes the *live* card to the
   registry (so the registry never describes something thewyze.com doesn't serve), and creates the GitHub release
   from the CHANGELOG section:

   ```bash
   gh run watch -R The-Wyze/MCP
   ```

   If the deploy took longer than the wait, re-run it: `gh workflow run publish.yml -R The-Wyze/MCP`. Re-runs are
   safe: a version the registry already lists is skipped, and an existing release is left alone.

## Where the new version shows up

- **Official MCP Registry**: from the workflow. Glama, PulseMCP, mcprush and GitHub's MCP registry import from it.
- **Gemini CLI extensions and cursor.directory**: read this repo; the manifests carry the version.
- **Everything else** (Claude's connector directory, Smithery and the rest): manual submissions.
