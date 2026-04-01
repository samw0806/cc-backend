export function isUpgradeRequestAuthorized(
  authHeader: string | string[] | undefined,
  queryToken: string | string[] | undefined,
  expectedToken?: string
): boolean {
  if (!expectedToken) return true

  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const queryValue = Array.isArray(queryToken) ? queryToken[0] : queryToken

  if (headerValue === `Bearer ${expectedToken}`) return true
  if (queryValue === expectedToken) return true

  return false
}
