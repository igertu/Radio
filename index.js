import "dotenv/config";
import express from "express";
import { spawn } from "node:child_process";
import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} from "@discordjs/voice";

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

const startingGuilds = new Set();
const leavingTimers = new Map();
const audioProcesses = new Map();
const players = new Map();
const connections = new Map();

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

function stopAudio(guildId) {
  const processes = audioProcesses.get(guildId);

  if (processes) {
    for (const process of processes) {
      try {
        process.kill("SIGTERM");
      } catch {}
    }

    audioProcesses.delete(guildId);
  }

  const player = players.get(guildId);

  if (player) {
    try {
      player.stop(true);
    } catch {}
    players.delete(guildId);
  }
}

function scheduleLeaveIfEmpty(channel) {
  const guildId = channel.guild.id;

  if (getHumanMembers(channel).size > 0) {
    cancelLeaveTimer(guildId);
    return;
  }

  if (leavingTimers.has(guildId)) return;

  console.log("Kanał jest pusty. Bot rozłączy się za 15 sekund.");

  const timer = setTimeout(() => {
    leavingTimers.delete(guildId);

    const guild = client.guilds.cache.get(guildId);
    const botMember = guild?.members.me;
    const currentChannel = botMember?.voice.channel;

    if (!currentChannel) return;
    if (currentChannel.id !== TARGET_CHANNEL_ID) return;

    if (getHumanMembers(currentChannel).size > 0) return;

    console.log("Brak ludzi na kanale. Zatrzymuję muzykę i rozłączam bota.");

    stopAudio(guildId);

    try {
      connections.get(guildId)?.destroy();
    } catch (error) {
      console.error("Błąd rozłączania:", error);
    }

    connections.delete(guildId);
  }, LEAVE_DELAY_MS);

  leavingTimers.set(guildId, timer);
}

async function playMusic(voiceChannel, member) {
  const guild = voiceChannel.guild;
  const guildId = guild.id;

  if (startingGuilds.has(guildId)) return;
  startingGuilds.add(guildId);

  let ytdlp;
  let ffmpeg;

  try {
    const botMember = guild.members.me;

    const permissions = voiceChannel.permissionsFor(botMember);

    if (
      !permissions?.has("ViewChannel") ||
      !permissions?.has("Connect") ||
      !permissions?.has("Speak")
    ) {
      console.error("Brak uprawnień View Channel, Connect lub Speak.");
      return;
    }

    console.log(`Kanał głosowy: ${voiceChannel.name}`);
    console.log(`Adres utworu: ${MUSIC_URL}`);
    console.log("Uruchamiam yt-dlp...");

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    connections.set(guildId, connection);

    connection.on("error", (error) => {
      console.error("Błąd połączenia głosowego:", error);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    if (getHumanMembers(voiceChannel).size === 0) {
      console.log("Nikt już nie jest na kanale. Nie uruchamiam muzyki.");
      connection.destroy();
      connections.delete(guildId);
      return;
    }

    const player = createAudioPlayer();
    players.set(guildId, player);
    connection.subscribe(player);

    ytdlp = spawn(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio/best",
        "-o",
        "-",
        MUSIC_URL,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    audioProcesses.set(guildId, [ytdlp, ffmpeg]);

    ytdlp.stdout.pipe(ffmpeg.stdin);

    ytdlp.stderr.setEncoding("utf8");
    ytdlp.stderr.on("data", (data) => {
      console.error("yt-dlp:", data.trim());
    });

    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (data) => {
      console.log("FFmpeg:", data.trim());
    });

    ytdlp.on("error", (error) => {
      console.error("Nie udało się uruchomić yt-dlp:", error);
    });

    ffmpeg.on("error", (error) => {
      console.error("Nie udało się uruchomić FFmpeg:", error);
    });

    ytdlp.on("close", (code) => {
      console.log(`yt-dlp zakończył działanie. Kod: ${code}`);
      if (code !== 0 && code !== null) {
        console.error("yt-dlp nie pobrał strumienia audio.");
      }
    });

    ffmpeg.on("close", (code) => {
      console.log(`FFmpeg zakończył działanie. Kod: ${code}`);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
    });

    player.on(AudioPlayerStatus.Playing, () => {
      console.log("🎵 Odtwarzanie rozpoczęte!");

      const textChannel =
        guild.systemChannel ??
        guild.channels.cache.find(
          (channel) =>
            channel.isTextBased() &&
            channel.permissionsFor(botMember)?.has("SendMessages")
        );

      textChannel?.send("🎵 Muzyka zaczęła grać!").catch(() => {});
    });

    player.on("error", (error) => {
      console.error("Błąd odtwarzacza audio:", error);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log("Odtwarzanie zakończone.");
    });

    player.play(resource);
    console.log(`Żądanie odtwarzania wysłane przez użytkownika ${member.user.tag}.`);
  } catch (error) {
    console.error("Błąd uruchamiania muzyki:", error?.stack || error);

    try {
      ytdlp?.kill("SIGTERM");
      ffmpeg?.kill("SIGTERM");
    } catch {}

    connections.get(guild.id)?.destroy();
    connections.delete(guild.id);
  } finally {
    startingGuilds.delete(guildId);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot gotowy jako ${readyClient.user.tag}`);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild;

  try {
    const botMember = guild.members.me;
    if (!botMember) return;

    const botChannel = botMember.voice.channel;

    if (botChannel?.id === TARGET_CHANNEL_ID) {
      scheduleLeaveIfEmpty(botChannel);
    }

    const member = newState.member;

    if (!member || member.user.bot) return;

    if (
      newState.channelId === TARGET_CHANNEL_ID &&
      oldState.channelId !== TARGET_CHANNEL_ID
    ) {
      const voiceChannel = newState.channel;
      if (!voiceChannel) return;

      cancelLeaveTimer(guild.id);

      if (botMember.voice.channelId === TARGET_CHANNEL_ID) {
        console.log("Bot już jest na kanale docelowym.");
        return;
      }

      await playMusic(voiceChannel, member);
    }
  } catch (error) {
    console.error("Błąd obsługi kanału głosowego:", error?.stack || error);
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Błąd logowania Discord:", error);
});
