import "dotenv/config";
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
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

  console.log("Kanał pusty. Rozłączanie za 15 sekund.");

  const timer = setTimeout(() => {
    leavingTimers.delete(guildId);

    const guild = client.guilds.cache.get(guildId);
    const botMember = guild?.members.me;
    const currentChannel = botMember?.voice.channel;

    if (!currentChannel) return;
    if (currentChannel.id !== TARGET_CHANNEL_ID) return;
    if (getHumanMembers(currentChannel).size > 0) return;

    console.log("Rozłączam bota.");

    stopAudio(guildId);

    try {
      connections.get(guildId)?.destroy();
    } catch (error) {
      console.error(error);
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
      console.error("Brak wymaganych uprawnień.");
      return;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    connections.set(guildId, connection);

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );

    if (getHumanMembers(voiceChannel).size === 0) {
      connection.destroy();
      connections.delete(guildId);
      return;
    }

    const player = createAudioPlayer();

    players.set(guildId, player);

    connection.subscribe(player);

    ytdlp = spawn("yt-dlp", [
      ytdlp.on("error", (err) => {
        console.error("Błąd yt-dlp:", err);
      });


    ffmpeg = spawn("ffmpeg", [
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
    ]);

    audioProcesses.set(guildId, [ytdlp, ffmpeg]);

    ytdlp.stdout.pipe(ffmpeg.stdin);

    ytdlp.stderr.on("data", (data) => {
      console.error(`yt-dlp: ${data}`);
    });

    ffmpeg.stderr.on("data", (data) => {
      console.error(`ffmpeg: ${data}`);
    });

    player.on(AudioPlayerStatus.Playing, () => {
      console.log("🎵 Odtwarzanie rozpoczęte");
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log("Odtwarzanie zakończone");
    });

    player.on("error", (error) => {
      console.error("Błąd odtwarzacza:", error);
    });

    const resource = createAudioResource(
      ffmpeg.stdout,
      {
        inputType: StreamType.Raw,
      }
    );

    if (!ffmpeg.stdout) {
      console.error("Brak strumienia audio.");
      return;
    }

    player.play(resource);

    console.log(
      `Uruchomione przez ${member.user.tag}`
    );
  } catch (error) {
    console.error(error);

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
        return;
      }

      await playMusic(voiceChannel, member);
    }
  } catch (error) {
    console.error(error);
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Błąd logowania:", error);
});
