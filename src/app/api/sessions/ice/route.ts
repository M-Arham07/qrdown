import { z } from "zod";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/redis";
import { STUN_SERVERS, TURN_SERVERS } from "@/lib/constants";
import { RoomSession } from "@/types/session";

const iceUrl = z.string().regex(/^(stun|stuns|turn|turns):/);
const cloudflareResponse = z.object({
  iceServers: z.array(z.object({
    urls: z.union([iceUrl, z.array(iceUrl).min(1)]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })).min(1),
});
const credentialsTtlSeconds = 86400;

export async function POST(req: Request) {
  const body = z.object({ roomId: z.string().min(1), secret: z.string().min(1) })
    .safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Room credentials are required" }, { status: 400 });
  }
  const { roomId, secret } = body.data;
  const session = roomId ? await sessionStore.get<RoomSession>(`room:${roomId}`) : null;
  if (!session || session.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized session" }, { status: 403 });
  }

  if (await sessionStore.get(`cancelled:${roomId}`)) {
    return NextResponse.json({ error: "Session cancelled" }, { status: 410 });
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (keyId || apiToken) {
    if (!keyId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare TURN configuration is incomplete" }, { status: 503 });
    }
    try {
      // The API token stays on the server; browsers receive only expiring credentials.
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: credentialsTtlSeconds }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!response.ok) {
        console.warn("[TURN] Cloudflare credential request failed", { status: response.status });
        return NextResponse.json({ error: "Could not obtain relay credentials" }, { status: 502 });
      }
      const parsed = cloudflareResponse.safeParse(await response.json());
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid relay configuration received" }, { status: 502 });
      }
      // Port 53 is blocked by browsers; retain UDP, TCP and TLS alternatives.
      const iceServers = parsed.data.iceServers.map(server => ({
        ...server,
        urls: [server.urls].flat().filter(url => !/:53(?:\?|$)/.test(url)),
      })).filter(server => server.urls.length > 0);
      const hasRelay = iceServers.some(server => server.username && server.credential &&
        server.urls.some(url => /^turns?:/.test(url)));
      if (!hasRelay) {
        return NextResponse.json({ error: "No authenticated relay was provided" }, { status: 502 });
      }
      if (await sessionStore.get(`cancelled:${roomId}`)) {
        return NextResponse.json({ error: "Session cancelled" }, { status: 410 });
      }
      return NextResponse.json({
        iceServers, dedicatedRelay: true, provider: "cloudflare", expiresIn: credentialsTtlSeconds,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      // Do not log provider response bodies, tokens or generated credentials.
      return NextResponse.json({ error: "Relay service is temporarily unavailable" }, { status: 502 });
    }
  }

  // TURN_URLS should include UDP, TCP and TLS on port 443 for restrictive networks.
  const urls = (process.env.TURN_URLS || "").split(",").map(url => url.trim()).filter(Boolean);
  if (urls.some(url => !/^turns?:/.test(url))) {
    return NextResponse.json({ error: "Invalid TURN_URLS configuration" }, { status: 500 });
  }
  let username = process.env.TURN_USERNAME;
  let credential = process.env.TURN_CREDENTIAL;
  if (process.env.TURN_SHARED_SECRET) {
    // coturn REST authentication: the shared secret stays on the server.
    username = `${Math.floor(Date.now() / 1000) + 3600}:${roomId}`;
    credential = createHmac("sha1", process.env.TURN_SHARED_SECRET).update(username).digest("base64");
  }
  const dedicatedRelay = Boolean(urls.length && username && credential);
  if (urls.length && !dedicatedRelay) {
    return NextResponse.json({ error: "TURN credentials are missing" }, { status: 500 });
  }
  return NextResponse.json({
    iceServers: [...STUN_SERVERS, ...(dedicatedRelay ? [{ urls, username, credential }] : TURN_SERVERS)],
    dedicatedRelay,
  }, { headers: { "Cache-Control": "no-store" } });
}
