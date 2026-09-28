// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

// Asserts the Google sign-in redirect without contacting Google: Supabase's authorize URL, the
// callback as redirect_to, a PKCE challenge, and the code-verifier cookie the callback reads.
function checkGoogleRedirect(actual, cookies) {
  let url;
  try {
    url = new URL(actual.location);
  } catch {
    return `location is not an absolute URL: ${actual.location}`;
  }
  if (!url.pathname.endsWith("/auth/v1/authorize")) return `unexpected path ${url.pathname}`;
  if (url.searchParams.get("provider") !== "google") return `provider=${url.searchParams.get("provider")}`;
  const redirectTo = url.searchParams.get("redirect_to");
  if (redirectTo !== `${BASE_URL}/auth/callback`) return `redirect_to=${redirectTo}`;
  const method = url.searchParams.get("code_challenge_method");
  if (method !== "s256") return `code_challenge_method=${method}`;
  if (![...cookies.keys()].some((name) => name.endsWith("-auth-token-code-verifier"))) {
    return "no *-auth-token-code-verifier cookie set";
  }
  return true;
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["privacy page renders", () => request("/privacy"), { status: 200 }],
  [
    "google signin redirects to Supabase authorize",
    () => request("/api/auth/google", { method: "POST" }),
    { status: 302, check: checkGoogleRedirect },
  ],
  [
    "callback reports cancelled provider consent",
    () => request("/auth/callback?error=access_denied&error_description="),
    { status: 302, location: "/auth/signin?error=Sign-in%20was%20cancelled" },
  ],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const checkResult = expected.check ? expected.check(actual, jar) : true;
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location)) &&
    checkResult === true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
    if (checkResult !== true) console.log(`      check failed: ${checkResult}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
