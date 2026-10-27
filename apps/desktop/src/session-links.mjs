export function sessionLinkId(href) {
  return /^agent-workspace:\/\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(href || "")?.[1]?.toLowerCase() ?? null;
}
