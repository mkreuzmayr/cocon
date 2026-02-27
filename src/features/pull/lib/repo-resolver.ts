import { regex } from 'arkregex';

export interface ResolvedRepository {
  host: 'github' | 'gitlab' | 'bitbucket';
  owner: string;
  repo: string;
  directory?: string;
}

type RepositoryField =
  | { type?: string; url?: string; directory?: string }
  | string
  | undefined;

function cleanRepoName(repo: string): string {
  return repo.replace(/\.git$/i, '').replace(/\/+$/g, '');
}

function inferHost(hostname: string): ResolvedRepository['host'] | null {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  if (
    normalized === 'github' ||
    normalized === 'github.com' ||
    normalized === 'github.org'
  ) {
    return 'github';
  }
  if (
    normalized === 'gitlab' ||
    normalized === 'gitlab.com' ||
    normalized === 'gitlab.org'
  ) {
    return 'gitlab';
  }
  if (
    normalized === 'bitbucket' ||
    normalized === 'bitbucket.com' ||
    normalized === 'bitbucket.org'
  ) {
    return 'bitbucket';
  }
  return null;
}

function parseOwnerRepo(
  host: ResolvedRepository['host'],
  owner: string,
  repo: string,
  directory?: string
): ResolvedRepository {
  return {
    host,
    owner,
    repo: cleanRepoName(repo),
    directory,
  };
}

export function parseRepositoryUrl(
  repository: RepositoryField
): ResolvedRepository | null {
  if (!repository) {
    return null;
  }

  const url = typeof repository === 'string' ? repository : repository.url;

  const directory =
    typeof repository === 'string' ? undefined : repository.directory;

  if (url == null) {
    return null;
  }

  const normalizedUrl = url
    .trim()
    .replace(/^git\+/, '')
    .replace(/#.*$/, '');

  // Handle shorthand formats
  // github:user/repo
  const shorthandMatch = regex(
    '^(github|gitlab|bitbucket):([^/]+)/([^#]+)$'
  ).exec(normalizedUrl);

  if (shorthandMatch) {
    const [, host, owner, repo] = shorthandMatch;

    return parseOwnerRepo(host, owner, repo, directory);
  }

  // Handle bare GitHub owner/repo
  const bareGithubMatch = regex('^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$').exec(
    normalizedUrl
  );

  if (bareGithubMatch) {
    const [, owner, repo] = bareGithubMatch;
    return parseOwnerRepo('github', owner, repo, directory);
  }

  // Handle SSH format: git@github.com:user/repo.git
  const scpMatch = regex(
    '^git@(github|gitlab|bitbucket)(?:.com|.org):([^/]+)/([^#]+)$'
  ).exec(normalizedUrl);

  if (scpMatch) {
    const [, host, owner, repo] = scpMatch;
    return parseOwnerRepo(host, owner, repo, directory);
  }

  // Handle ssh://git@github.com:user/repo.git
  const sshColonMatch = regex(
    '^ssh://git@(github|gitlab|bitbucket)(?:.com|.org):([^/]+)/([^#]+)$'
  ).exec(normalizedUrl);

  if (sshColonMatch) {
    const [, host, owner, repo] = sshColonMatch;

    return parseOwnerRepo(host, owner, repo, directory);
  }

  // Handle full URLs
  // https://github.com/user/repo.git
  // https://github.com/user/repo
  // git://github.com/user/repo.git
  // ssh://git@github.com/user/repo.git
  try {
    const parsed = new URL(normalizedUrl);
    const host = inferHost(parsed.hostname);

    if (!host) {
      return null;
    }

    const [owner, repo] = parsed.pathname.replace(/^\/+/, '').split('/');

    if (!owner || !repo) {
      return null;
    }

    return parseOwnerRepo(host, owner, repo, directory);
  } catch {
    return null;
  }
}

export function toHttpsRepositoryUrl(repo: ResolvedRepository): string {
  switch (repo.host) {
    case 'github':
      return `https://github.com/${repo.owner}/${repo.repo}`;
    case 'gitlab':
      return `https://gitlab.com/${repo.owner}/${repo.repo}`;
    case 'bitbucket':
      return `https://bitbucket.org/${repo.owner}/${repo.repo}`;
    default:
      throw new Error(`Unsupported host: ${repo.host}`);
  }
}

export function normalizeRepositoryUrlToHttps(
  repository: RepositoryField
): string | null {
  const parsed = parseRepositoryUrl(repository);

  if (!parsed) {
    return null;
  }
  return toHttpsRepositoryUrl(parsed);
}

export interface NormalizedRepository {
  repo: ResolvedRepository;
  httpsUrl: string;
}

export function normalizeRepositoryToHttpsRepo(
  repository: RepositoryField
): NormalizedRepository | null {
  const parsed = parseRepositoryUrl(repository);

  if (!parsed) {
    return null;
  }

  const httpsUrl = toHttpsRepositoryUrl(parsed);
  const normalized = parseRepositoryUrl({
    url: httpsUrl,
    directory: parsed.directory,
  });

  if (!normalized) {
    return null;
  }

  return {
    repo: normalized,
    httpsUrl,
  };
}

export function getTagTarballUrl(
  repo: ResolvedRepository,
  tag: string
): string {
  const { host, owner, repo: repoName } = repo;

  switch (host) {
    case 'github':
      return `https://github.com/${owner}/${repoName}/archive/refs/tags/${tag}.tar.gz`;
    case 'gitlab':
      return `https://gitlab.com/${owner}/${repoName}/-/archive/${tag}/${repoName}-${tag}.tar.gz`;
    case 'bitbucket':
      return `https://bitbucket.org/${owner}/${repoName}/get/${tag}.tar.gz`;
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}

export function getDefaultBranchTarballUrls(
  repo: ResolvedRepository
): string[] {
  const { host, owner, repo: repoName } = repo;

  switch (host) {
    case 'github':
      return [
        `https://github.com/${owner}/${repoName}/archive/refs/heads/main.tar.gz`,
        `https://github.com/${owner}/${repoName}/archive/refs/heads/master.tar.gz`,
      ];
    case 'gitlab':
      return [
        `https://gitlab.com/${owner}/${repoName}/-/archive/main/${repoName}-main.tar.gz`,
        `https://gitlab.com/${owner}/${repoName}/-/archive/master/${repoName}-master.tar.gz`,
      ];
    case 'bitbucket':
      return [
        `https://bitbucket.org/${owner}/${repoName}/get/main.tar.gz`,
        `https://bitbucket.org/${owner}/${repoName}/get/master.tar.gz`,
      ];
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}
