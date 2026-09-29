const appBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${appBase}${normalizedPath}`;
}