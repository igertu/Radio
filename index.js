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

// ID kanału głosowego „Ogólny”
const TARGET_CHANNEL_ID = "1325124055627599913";

// Na razie testujemy pojedynczy utwór z YouTube
const MUSIC_URL = "https://www.youtube.com/watch?v=ElZrFjVk_3I";

// Jeśli chcesz wrócić do playlisty Spotify, użyj zamiast adresu powyżej:
// const MUSIC_URL = "https://open.spotify.com/playlist/3DmkMyHBtiSUGdBFeWm3BX?si=1bcc0fb2415b4ce0&pt=96c65f2c032eb1af174a7f500e5a016c";

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

const LEAVE_DELAY_MS = 15_000; // Wyjdź po 15 sekundach bez ludzi

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

  cancelLeaveTimer(guildId);

  const timer = setTimeout(async () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      const botMember = guild?.members.me;
      const botVoiceChannel = botMember?.voice.channel;

      if (!botVoiceChannel) return;

      // Sprawdź ponownie, czy na kanale nadal nie ma ludzi
      if (getHumanMembers(botVoiceChannel).size > 0) return;

      console.log("Brak ludzi na kanale. Bot rozłącza się.");

      try {
        distube.voices.get(guildId)?.stop();
      } catch (error) {
        console.log("Nie udało się zatrzymać utworu:", error.message);
      }

      botMember.voice.disconnect();
    } catch (error) {
      console.error("Błąd podczas rozłączania bota:", error);
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
  queue.textChannel?.send(`🎵 Teraz gram: **${song.name}**`).catch(() => {});
});

distube.on("addSong", (queue, song) => {
  console.log(`Dodano utwór: ${song.name}`);
});

distube.on("error", (error, queue, song) => {
  console.error("Błąd DisTube:", error?.stack || error);

  if (queue?.textChannel) {
    queue.textChannel
      .send(`❌ Nie udało się odtworzyć muzyki${song?.name ? `: ${song.name}` : ""}. Sprawdź logi Render.`)
      .catch(() => {});
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild = newState.guild;
    const botMember = guild.members.me;

    if (!botMember) return;

    // Jeśli bot jest na kanale docelowym i ludzie wychodzą,
    // sprawdzamy, czy powinien się rozłączyć.
    const botVoiceChannel = botMember.voice.channel;

    if (botVoiceChannel?.id === TARGET_CHANNEL_ID) {
      scheduleLeaveIfEmpty(botVoiceChannel);
    }

    const member = newState.member;

    // Ignoruj samego bota i innych botów
    if (!member || member.user.bot) return;

    // Reaguj tylko na wejście człowieka na kanał docelowy
    if (newState.channelId !== TARGET_CHANNEL_ID) return;

    const voiceChannel = newState.channel;

    if (!voiceChannel) return;

    // Ktoś wrócił — anuluj zaplanowane rozłączenie
    cancelLeaveTimer(guild.id);

    // Jeśli bot już jest na kanale, nie uruchamiaj drugiego odtwarzania
    if (botMember.voice.channelId === TARGET_CHANNEL_ID) {
      console.log("Bot już jest na kanale docelowym.");
      return;
    }

    // Zapobiegaj kilku próbom jednocześnie
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
          "Bot nie ma uprawnień View Channel, Connect lub Speak na kanale."
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

      await distube.play(voiceChannel, MUSIC_URL, {
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
