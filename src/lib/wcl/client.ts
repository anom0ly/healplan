/**
 * Minimal Warcraft Logs v2 GraphQL client (client-credentials flow, public logs only).
 * Docs: https://www.warcraftlogs.com/v2-api-docs/warcraft/
 */

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const API_URL = "https://www.warcraftlogs.com/api/v2/client";

export interface RateLimit {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
}

export class WclClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId = process.env.WCL_CLIENT_ID ?? "",
    private readonly clientSecret = process.env.WCL_CLIENT_SECRET ?? "",
  ) {
    if (!clientId || !clientSecret) throw new Error("WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set");
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`WCL token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`WCL query failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`WCL query error: ${body.errors.map((e) => e.message).join("; ")}`);
    return body.data as T;
  }

  async rateLimit(): Promise<RateLimit> {
    const d = await this.query<{ rateLimitData: RateLimit }>(
      `{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`,
    );
    return d.rateLimitData;
  }
}
