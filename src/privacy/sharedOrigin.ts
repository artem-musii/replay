const GITHUB_PAGES_HOST_SUFFIX = ".github.io";

export function isSharedGitHubPagesHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized.length > GITHUB_PAGES_HOST_SUFFIX.length &&
    normalized.endsWith(GITHUB_PAGES_HOST_SUFFIX)
  );
}
