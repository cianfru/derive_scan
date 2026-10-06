// Gates the X card control page behind one password.
export const config = { matcher: ["/control", "/control/:path*", "/control.html"] };

function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function allowed(header, expected) {
  if (!expected || !header || !header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const at = decoded.indexOf(":");
  return at >= 0 && same(decoded.slice(at + 1), expected);
}

export default function middleware(request) {
  if (allowed(request.headers.get("authorization"), process.env.CONTROL_PASSWORD)) return undefined;
  return new Response("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Cowboy control", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
