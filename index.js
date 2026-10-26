import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";
import { DisTube } from "distube";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("Bot muzyczny działa!");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serwer HTTP działa na porcie ${PORT}`);
});

const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = "1325124055627599913";
const MUSIC_URL = "https://www.youtube.com/watch?v=ElZrFjVk_3I";
const LEAVE_DELAY_MS = 15_000;
const DIAGNOSTIC_DELAY_MS = 20_000;

if (!TOKEN) {
  console.error("Brak DISCORD_TOKEN w ustawieniach Render!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const distube = new DisTube(client, {
  plugins: [
    new YouTubePlugin(),
    new SpotifyPlugin(),
  ],
});

const startingGuilds = new Set();
const leavingTimers = new Map();

function getHumanMembers(channel) {
  return channel.members.filter((member) => !member.user.bot);
}

function cancelLeaveTimer(guildId) {
  const timer = leavingTimers.get(guildId);

  if (timer) {
    clearTimeout(timer);
    leavingTimers.delete(guildId);
  }
}

function scheduleLeaveIfEmpty(channel) {
  const guildId = channel.guild.id;

  if (getHumanMembers(channel).size > 0) {
    cancelLeaveTimer(guildId);
    return;
  }

  if (leavingTimers.has(guildId)) return;

  const timer = setTimeout(() => {
    try {
      const guild = client.guilds.cache.get(guildId);
      const botMember = guild?.members.me;
      const currentChannel = botMember?.voice.channel;

      if (!currentChannel) return;
      if (getHumanMembers(currentChannel).size > 0) return;

      console.log("Brak ludzi na kanale. Bot się rozłącza.");

      try {
        distube.voices.get(guildId)?.stop();
      } catch (error) {
        console.error("Błąd zatrzymywania muzyki:", error);
      }

      botMember.voice.disconnect();
    } catch (error) {
      console.error("Błąd rozłączania bota:", error);
    } finally {
      leavingTimers.delete(guildId);
    }
  }, LEAVE_DELAY_MS);

  leavingTimers.set(guildId, timer);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot gotowy jako ${readyClient.user.tag}`);
});

distube.on("initQueue", (queue) => {
  console.log(`DisTube utworzył kolejkę na serwerze ${queue.id}`);
});

distube.on("playSong", (queue, song) => {
  console.log(`Odtwarzanie rozpoczęte: ${song.name}`);

  queue.textChannel
    ?.send(`🎵 Teraz gram: **${song.name}**`)
    .catch(() => {});
});

distube.on("addSong", (_queue, song) => {
  console.log(`Dodano utwór: ${song.name}`);
});

distube.on("empty", (queue) => {
  console.log(`Kolejka jest pusta na serwerze ${queue.id}`);
});

distube.on("error", (error, queue, song) => {
  console.error("Błąd DisTube:", error?.stack || error);

  queue?.textChannel
    ?.send(
      `❌ Błąd odtwarzania${
        song?.name ? `: ${song.name}` : ""
      }. Sprawdź logi Render.`
    )
    .catch(() => {});
});

client.on(Events.VoiceStateUpdate, async (_oldState, newState) => {
  const guild = newState.guild;

  try {
    const botMember = guild.members.me;
    if (!botMember) return;

    const currentBotChannel = botMember.voice.channel;

    if (currentBotChannel?.id === TARGET_CHANNEL_ID) {
      scheduleLeaveIfEmpty(currentBotChannel);
    }

    const member = newState.member;

    if (!member || member.user.bot) return;
    if (newState.channelId !== TARGET_CHANNEL_ID) return;

    const voiceChannel = newState.channel;
    if (!voiceChannel) return;

    cancelLeaveTimer(guild.id);

    if (botMember.voice.channelId === TARGET_CHANNEL_ID) {
      console.log("Bot już jest na kanale docelowym.");
      return;
    }

    if (startingGuilds.has(guild.id)) return;

    startingGuilds.add(guild.id);

    let diagnosticTimer;

    try {
      const permissions = voiceChannel.permissionsFor(botMember);

      if (
        !permissions?.has("ViewChannel") ||
        !permissions?.has("Connect") ||
        !permissions?.has("Speak")
      ) {
        console.error(
          "Brak uprawnień View Channel, Connect lub Speak."
        );
        return;
      }

      const textChannel =
        guild.systemChannel ??
        guild.channels.cache.find(
          (channel) =>
            channel.isTextBased() &&
            channel.permissionsFor(botMember)?.has("SendMessages")
        );

      console.log(`Kanał głosowy: ${voiceChannel.name}`);
      console.log(`Adres utworu: ${MUSIC_URL}`);
      console.log("START: wywołuję distube.play()");

      diagnosticTimer = setTimeout(() => {
        console.error(
          `DIAGNOSTYKA: distube.play() nadal nie zakończyło działania po ${DIAGNOSTIC_DELAY_MS / 1000} sekundach.`
        );
        console.error(
          "Sprawdź, czy pojawił się osobny błąd wtyczki YouTube lub DisTube."
        );
      }, DIAGNOSTIC_DELAY_MS);

      await distube.play(voiceChannel, MUSIC_URL, {
        member,
        textChannel: textChannel ?? undefined,
      });

      console.log("KONIEC: distube.play() zakończyło działanie");
    } catch (error) {
      console.error(
        "Błąd uruchamiania muzyki:",
        error?.stack || error
      );
    } finally {
      if (diagnosticTimer) clearTimeout(diagnosticTimer);
      startingGuilds.delete(guild.id);
    }
  } catch (error) {
    console.error(
      "Błąd obsługi kanału głosowego:",
      error?.stack || error
    );
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Błąd logowania Discord:", error);
});
