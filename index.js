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

// Testowy utwór z YouTube
const MUSIC_URL = "https://www.youtube.com/watch?v=ElZrFjVk_3I";

// Aby używać playlisty Spotify, zamień MUSIC_URL powyżej
// na adres swojej playlisty Spotify.

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

const LEAVE_DELAY_MS = 15_000;

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

  const timer = setTimeout(async () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      const botMember = guild?.members.me;
      const botVoiceChannel = botMember?.voice.channel;

      if (!botVoiceChannel) return;

      if (getHumanMembers(botVoiceChannel).size > 0) return;

      console.log("Na kanale nie ma ludzi. Bot się rozłącza.");

      try {
        distube.voices.get(guildId)?.stop();
      } catch (error) {
        console.error("Błąd zatrzymywania muzyki:", error.message);
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

distube.on("playSong", (queue, song) => {
  console.log(`Odtwarzam: ${song.name}`);

  queue.textChannel
    ?.send(`🎵 Teraz gram: **${song.name}**`)
    .catch(() => {});
});

distube.on("addSong", (_queue, song) => {
  console.log(`Dodano utwór: ${song.name}`);
});

distube.on("error", (error, queue, song) => {
  console.error("Błąd DisTube:", error?.stack || error);

  queue?.textChannel
    ?.send(
      `❌ Nie udało się odtworzyć muzyki${
        song?.name ? `: ${song.name}` : ""
      }. Sprawdź logi Render.`
    )
    .catch(() => {});
});

client.on(Events.VoiceStateUpdate, async (_oldState, newState) => {
  try {
    const guild = newState.guild;
    const botMember = guild.members.me;

    if (!botMember) return;

    const botVoiceChannel = botMember.voice.channel;

    // Aktualizuj automatyczne rozłączanie, gdy ktoś wychodzi
    if (botVoiceChannel?.id === TARGET_CHANNEL_ID) {
      scheduleLeaveIfEmpty(botVoiceChannel);
    }

    const member = newState.member;

    if (!member || member.user.bot) return;

    // Uruchamiaj muzykę, gdy człowiek wchodzi na kanał docelowy
    if (newState.channelId !== TARGET_CHANNEL_ID) return;

    const voiceChannel = newState.channel;

    if (!voiceChannel) return;

    cancelLeaveTimer(guild.id);

    // Bot jest już na kanale — nie uruchamiaj drugiej kolejki
    if (botMember.voice.channelId === TARGET_CHANNEL_ID) {
      console.log("Bot już jest na kanale docelowym.");
      return;
    }

    if (startingGuilds.has(guild.id)) return;

    startingGuilds.add(guild.id);

    try {
      const permissions = voiceChannel.permissionsFor(botMember);

      if (
        !permissions?.has("ViewChannel") ||
        !permissions?.has("Connect") ||
        !permissions?.has("Speak")
      ) {
        console.error(
          "Bot nie ma uprawnień View Channel, Connect lub Speak."
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

      console.log(`Próba odtwarzania na kanale: ${voiceChannel.name}`);
      console.log(`Adres muzyki: ${MUSIC_URL}`);
      console.log("Sprawdzam, czy DisTube znajduje utwór...");

      const results = await distube.search(MUSIC_URL, {
        type: "video",
        limit: 1,
      });

      console.log(
        "Wyniki wyszukiwania:",
        results.map((song) => song.name)
      );

      if (!results.length) {
        throw new Error("DisTube nie znalazł żadnego utworu.");
      }

      console.log(`Znaleziono utwór: ${results[0].name}`);
      console.log("Przekazuję utwór do odtwarzania...");

      await distube.play(voiceChannel, results[0].url, {
        member,
        textChannel: textChannel ?? undefined,
      });

      console.log("Polecenie odtwarzania wysłane do DisTube.");
    } catch (error) {
      console.error(
        "Nie udało się rozpocząć odtwarzania:",
        error?.stack || error
      );
    } finally {
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
