// Content-Security-Policy for the page (constitution Principle I; contracts/worker-protocol.md
// section 4). GitHub Pages cannot set response headers, so the policy ships as a <meta> tag.
// connect-src 'self' is what makes the browser itself refuse any cross-origin request.
//
// The strict policy is used in build and preview. The dev server needs a looser one because the
// React plugin injects an inline refresh script and HMR talks over a websocket (research.md R9).

const COMMON = [
  "default-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

export const STRICT_CSP = [
  ...COMMON,
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
].join("; ");

export const DEV_CSP = [
  ...COMMON,
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
].join("; ");
