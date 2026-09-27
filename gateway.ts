import WebSocket from "ws";
import { BotCommands } from "./commands.js";
import { DiscordRest } from "./discord-rest.js";
import type { DiscordInteraction } from "./types.js";

const INTENTS = 1 | 512 | 32768; // Guilds, Guild Messages, Message Content
const ERA_CHOICES = [
  { name: "Miscellaneous", value: "misc" },
  { name: "Base", value: "base" },
  { name: "Gym", value: "gym" },
  { name: "Neo", value: "neo" },
  { name: "Legendary Collection", value: "lc" },
  { name: "E-Card", value: "ecard" },
  { name: "EX", value: "ex" },
  { name: "POP", value: "pop" },
  { name: "Trainer Kits", value: "tk" },
  { name: "Diamond & Pearl", value: "dp" },
  { name: "Platinum", value: "pl" },
  { name: "HeartGold & SoulSilver", value: "hgss" },
  { name: "Call of Legends", value: "col" },
  { name: "Black & White", value: "bw" },
  { name: "McDonald's Collection", value: "mc" },
  { name: "XY", value: "xy" },
  { name: "Sun & Moon", value: "sm" },
  { name: "Sword & Shield", value: "swsh" },
  { name: "Scarlet & Violet", value: "sv" },
  { name: "Pokémon TCG Pocket", value: "tcgp" },
  { name: "Mega Evolution", value: "me" },
];

type GatewayPayload = {
  op: number;
  d?: any;
  s?: number | null;
  t?: string;
};

type BotApplication = { id: string; name?: string };
type ApplicationCommand = {
  id: string;
  name: string;
  type?: number;
  options?: Array<{ name: string }>;
};

export class DiscordGateway {
  private socket?: WebSocket;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private gatewayUrl = "wss://gateway.discord.gg";
  private resumeUrl?: string;
  private sequence: number | null = null;
  private sessionId?: string;
  private applicationId?: string;
  private heartbeatInterval = 0;
  private heartbeatAcknowledged = true;
  private stopping = false;
  private reconnecting = false;
  private readyResolver?: () => void;

  constructor(
    private readonly token: string,
    private readonly rest: DiscordRest,
    private readonly commands: BotCommands,
  ) {}

  async start(): Promise<string> {
    const gateway = await this.rest.request<{ url: string }>("/gateway/bot");
    if (!gateway.url) throw new Error("Discord did not return a Gateway URL.");
    this.gatewayUrl = gateway.url;

    try {
      const app = await this.rest.request<BotApplication>("/oauth2/applications/@me");
      this.applicationId = app.id;
    } catch {
      this.applicationId = decodeApplicationId(this.token);
    }
    if (!this.applicationId) {
      throw new Error("Could not determine the Discord application ID from the bot token.");
    }

    await this.registerCommands();
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.readyResolver = undefined;
        reject(new Error("Discord Gateway did not send READY within 30 seconds."));
      }, 30_000);
      this.readyResolver = () => {
        clearTimeout(timeout);
        this.readyResolver = undefined;
        resolve();
      };
    });
    this.openSocket(this.resumeUrl ?? this.gatewayUrl);
    try {
      await ready;
      return this.applicationId;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.stopping = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "Bot shutdown");
  }

  private async registerCommands(): Promise<void> {
    const commands = [
      {
        name: "buy",
        description: "Configure and manage Pokémon marketplace buying",
        options: [
          {
            type: 1,
            name: "setup",
            description: "Set the negotiation ticket category for all buy forums",
            options: [
              { type: 7, name: "ticket_category", description: "Category where negotiation tickets are created", required: true, channel_types: [4] },
            ],
          },
          {
            type: 2,
            name: "forum",
            description: "Manage multiple buy Forum Channels",
            options: [
              {
                type: 1,
                name: "add",
                description: "Add a buy forum and choose its IN STOCK and SOLD OUT tags",
                options: [
                  { type: 7, name: "forum", description: "Forum Channel for listings", required: true, channel_types: [15] },
                  { type: 7, name: "ticket_category", description: "Category for negotiation tickets", required: false, channel_types: [4] },
                ],
              },
              {
                type: 1,
                name: "remove",
                description: "Remove a buy forum",
                options: [{ type: 7, name: "forum", description: "Forum Channel", required: true, channel_types: [15] }],
              },
              {
                type: 1,
                name: "list",
                description: "List all configured buy forums",
              },
            ],
          },
          {
            type: 1,
            name: "facilitator",
            description: "Choose the role pinged by the Facilitator button",
            options: [{ type: 8, name: "role", description: "Facilitator role", required: true }],
          },
          {
            type: 1,
            name: "dispute",
            description: "Choose the role pinged by the Dispute button",
            options: [{ type: 8, name: "role", description: "Dispute role", required: true }],
          },
          {
            type: 1,
            name: "configure-tags",
            description: "Change the IN STOCK and SOLD OUT tags for a configured forum",
            options: [{ type: 7, name: "forum", description: "Configured buy forum", required: true, channel_types: [15] }],
          },
          {
            type: 1,
            name: "list",
            description: "Show all current buy configurations",
          },
        ],
      },
    ];
    await this.rest.request(`/applications/${this.applicationId}/commands`, {
      method: "PUT",
      body: commands,
    });
  }

  private async removeLegacyGuildSetCommands(guildIds: string[]): Promise<void> {
    if (!this.applicationId) return;
    let removed = 0;
    await Promise.all(guildIds.map(async (guildId) => {
      try {
        const route = `/applications/${this.applicationId}/guilds/${encodeURIComponent(guildId)}/commands`;
        const commands = await this.rest.request<ApplicationCommand[]>(route);
        for (const command of commands) {
          if (command.name === "buy" && (command.type === undefined || command.type === 1)) continue;
          await this.rest.request(`${route}/${encodeURIComponent(command.id)}`, { method: "DELETE" });
          removed++;
        }
      } catch (error) {
        console.warn(`[commands] Could not clean old server commands in ${guildId}: ${(error as Error).message}`);
      }
    }));
    if (removed) console.info(`[commands] Removed ${removed} old server-specific command(s); /buy is the only command.`);
  }

  private async handlePayload(payload: GatewayPayload): Promise<void> {
    if (payload.op === 10) {
      this.heartbeatInterval = payload.d?.heartbeat_interval ?? 0;
      this.startHeartbeats();
      if (this.sessionId && this.sequence !== null) {
        this.send({
          op: 6,
          d: { token: this.token, session_id: this.sessionId, seq: this.sequence },
        });
      } else {
        this.send({
          op: 2,
          d: {
            token: this.token,
            intents: INTENTS,
            properties: { os: process.platform, browser: "pokemon-card-bot", device: "pokemon-card-bot" },
          },
        });
      }
      return;
    }
    if (payload.op === 1) {
      this.sendHeartbeat();
      return;
    }
    if (payload.op === 7) {
      this.socket?.close(4000, "Gateway requested reconnect");
      return;
    }
    if (payload.op === 9) {
      const resumable = Boolean(payload.d);
      if (!resumable) {
        this.sessionId = undefined;
        this.sequence = null;
        this.resumeUrl = undefined;
      }
      await sleep(1_500);
      this.socket?.close(4000, "Invalid session");
      return;
    }
    if (payload.op === 11) {
      this.heartbeatAcknowledged = true;
      return;
    }
    if (payload.op !== 0) return;

    if (typeof payload.s === "number") {
      this.sequence = payload.s;
    }

    if (payload.t === "READY") {
      this.sessionId = payload.d?.session_id;
      this.resumeUrl = payload.d?.resume_gateway_url;
      if (this.applicationId && payload.d?.application?.id) {
        this.applicationId = payload.d.application.id;
      }
      console.info(`[gateway] Connected as ${payload.d?.user?.username ?? "Discord bot"}.`);
      const guildIds: string[] = Array.isArray(payload.d?.guilds)
        ? payload.d.guilds.flatMap((guild: { id?: string }) =>
            typeof guild.id === "string" ? [guild.id] : [],
          )
        : [];
      void this.removeLegacyGuildSetCommands(guildIds);
      this.readyResolver?.();
    } else if (payload.t === "INTERACTION_CREATE") {
      void this.commands.handle(payload.d as DiscordInteraction).catch((error) => {
        console.error(`[gateway] Interaction handling failed: ${(error as Error).message}`);
      });
    } else if (payload.t === "MESSAGE_CREATE") {
      void this.commands.handleMessage(payload.d).catch((error) => {
        console.error(`[gateway] Message handling failed: ${(error as Error).message}`);
      });
    } else if (payload.t === "THREAD_CREATE") {
      void this.commands.handleThreadCreate(payload.d).catch((error) => {
        console.error(`[gateway] Thread handling failed: ${(error as Error).message}`);
      });
    } else if (payload.t === "THREAD_UPDATE") {
      void this.commands.handleThreadUpdate(payload.d).catch((error) => {
        console.error(`[gateway] Thread update handling failed: ${(error as Error).message}`);
      });
    }
  }

  private openSocket(url: string): void {
    if (this.stopping) return;

    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.close();
      } catch {
        // Ignore errors while replacing an old socket during reconnect.
      }
    }

    const separator = url.includes("?") ? "&" : "?";
    const socketUrl = `${url}${separator}v=10&encoding=json`;
    const socket = new WebSocket(socketUrl);
    this.socket = socket;

    socket.on("open", () => {
      console.info("[gateway] WebSocket connected; waiting for HELLO...");
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString()) as GatewayPayload;
        void this.handlePayload(payload).catch((error) => {
          console.error(`[gateway] Payload handling failed: ${(error as Error).message}`);
        });
      } catch (error) {
        console.error(`[gateway] Could not parse Discord Gateway payload: ${(error as Error).message}`);
      }
    });

    socket.on("error", (error) => {
      console.error(`[gateway] WebSocket error: ${error.message}`);
    });

    socket.on("close", (code, reason) => {
      if (this.socket === socket) this.socket = undefined;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
      if (this.stopping) return;
      console.warn(`[gateway] WebSocket closed (${code})${reason.length ? `: ${reason.toString()}` : ""}. Reconnecting...`);
      this.scheduleReconnect();
    });
  }

  private startHeartbeats(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!this.heartbeatInterval) return;
    this.heartbeatAcknowledged = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcknowledged) {
        this.socket?.close(4000, "Missed heartbeat acknowledgement");
        return;
      }
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  private sendHeartbeat(): void {
    this.heartbeatAcknowledged = false;
    this.send({ op: 1, d: this.sequence });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket(this.resumeUrl ?? this.gatewayUrl);
    }, 3_000);
  }
}

function decodeApplicationId(token: string): string | undefined {
  const firstPart = token.split(".")[0];
  if (!firstPart) return undefined;
  try {
    return Buffer.from(firstPart, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}