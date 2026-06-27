import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";

const REDIRECT_PORT = 3456;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const LINEAR_AUTH_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

// PKCE helpers
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

export function getAuthorizeUrl(clientId: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "read,write",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${LINEAR_AUTH_URL}?${params}`;
}

async function exchangeCode(
  clientId: string,
  code: string,
  codeVerifier: string
): Promise<string> {
  const res = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// Start a temporary local server, open the browser, wait for the OAuth callback
export async function performOAuthFlow(clientId: string): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const authorizeUrl = getAuthorizeUrl(clientId, codeChallenge);

  return new Promise<string>((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(400);
            res.end(`Authorization failed: ${error}`);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400);
            res.end("Missing authorization code");
            server.close();
            reject(new Error("No authorization code received"));
            return;
          }

          const accessToken = await exchangeCode(clientId, code, codeVerifier);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
              <h1>SprintSpends authorized!</h1>
              <p>You can close this tab and return to your terminal.</p>
            </body></html>
          `);

          server.close();
          resolve(accessToken);
        } catch (err) {
          res.writeHead(500);
          res.end("Internal error");
          server.close();
          reject(err);
        }
      }
    );

    server.listen(REDIRECT_PORT, () => {
      console.log(`\nOpen this URL to authorize SprintSpends with Linear:\n`);
      console.log(`  ${authorizeUrl}\n`);

      // Try to open browser automatically
      import("node:child_process").then(({ exec }) => {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${cmd} "${authorizeUrl}"`);
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out (5 minutes)"));
    }, 5 * 60 * 1000);
  });
}
