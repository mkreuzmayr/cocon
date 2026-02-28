# Cocon

`cocon` is a Bun + TypeScript tool that fetches npm package source code repositories into a shared cache to give agentic coding tools better context.

It has two runtime surfaces:

- A terminal CLI (`cocon`)
- An MCP server binary (`cocon-mcp`)

Package sources are always stored in `~/.cocon/packages`.
When you pull for a project, `cocon` also creates symlinks in `./.cocon/packages` so the project has local entry points into the shared cache.

## CLI commands

### `pull`

Pull and cache package repository source.

```bash
cocon pull <packages...>
```

### `sync`

Prefetch and cache repository sources for all dependencies in `package.json` in parallel.
Uses resolved project versions (installed version when available).

```bash
cocon sync
```

### `status`

Show installed vs cached versions, missing targets, and the version each package should pull.

```bash
cocon status
```

### `prune`

Remove old/unused cached versions while honoring keep rules.

```bash
cocon prune [--keep-latest <count>] [--no-keep-project-dependencies] [--keep <package@version...>] [--dry-run]
```

### `list`

List all cached package versions in the shared cache.

```bash
cocon list
```

### `get`

Get cached source info for one package in the shared cache (without downloading).
If multiple versions are cached, all matches are returned unless `--version` is supplied.

```bash
cocon get [--version <version>] <packageName>
```

## MCP tools

- `get_package_source`: resolve installed version from a project and fetch source if needed
- `sync_project_dependencies`: prefetch cache for all project dependencies in parallel
- `get_cache_status`: show installed vs cached versions and missing target cache entries
- `prune_cache`: prune old/unused cache versions with keep rules
- `list_cached_package_sources`: list all package cache entries in the shared cache
- `get_cached_package_source`: inspect existing cached package entries in the shared cache
