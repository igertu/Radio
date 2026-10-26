import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";
import { DisTube } from "distube";
import { SpotifyPlugin } from "@distube/spotify";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot muzyczny działa!");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serwer HTTP działa na porcie ${PORT}`);
});

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("Brak DISCORD_TOKEN w zmiennych środowiskowych Render!");
  process.exit(1);
}

const TARGET_CHANNEL_ID = "1325124055627599913";

const PLAYLIST_URL =
  "https://open.spotify.com/playlist/3DmkMyHBtiSUGdBFeWm3BX?si=1bcc0fb2415b4ce0&pt=96c65f2c032eb1af174a7f500e5a016c";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const distube = new DisTube(client, {
  plugins: [new SpotifyPlugin()],
});

const leaveTimers = new Map();
const startingGuilds = new Set();

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot muzyczny gotowy jako ${readyClient.user.tag}`);
});

distube.on("error", (error, queue) => {
  console.error("Błąd DisTube:", error.message);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const member = newState.member ?? oldState.member;

    if (!member || member.user.bot) return;

    const guild = newState.guild;
    const botVoiceChannel = guild.members.me?.voice.channel;

    // Ktoś wszedł na docelowy kanał głosowy
    if (
      newState.channelId === TARGET_CHANNEL_ID &&
      !botVoiceChannel &&
      !startingGuilds.has(guild.id)
    ) {
      startingGuilds.add(guild.id);

      try {
        const voiceChannel = newState.channel;

        if (!voiceChannel) return;

        const textChannel =
          guild.systemChannel ??
          guild.channels.cache.find(
            (channel) =>
              channel.isTextBased() &&
              channel.permissionsFor(guild.members.me)?.has("SendMessages")
          );

        console.log(`Próba dołączenia do kanału: ${voiceChannel.name}`);

        await distube.play(voiceChannel, PLAYLIST_URL, {
          member,
          textChannel: textChannel ?? undefined,
        });

        console.log("Uruchomiono próbę odtwarzania playlisty.");
      } catch (error) {
        console.error("Błąd dołączania lub odtwarzania:", error);
      } finally {
        startingGuilds.delete(guild.id);
      }
    }

    // Jeśli ktoś wrócił, anuluj timer opuszczania
    if (newState.channelId === TARGET_CHANNEL_ID) {
      const timer = leaveTimers.get(guild.id);

      if (timer) {
        clearTimeout(timer);
        leaveTimers.delete(guild.id);
      }
    }

    // Sprawdź, czy na kanale bota nie ma już ludzi
    const currentBotChannel = guild.members.me?.voice.channel;

    if (!currentBotChannel) return;

    const humans = currentBotChannel.members.filter(
      (voiceMember) => !voiceMember.user.bot
    );

    if (humans.size === 0 && !leaveTimers.has(guild.id)) {
      const timer = setTimeout(() => {
        const channel = guild.members.me?.voice.channel;

        if (
          channel &&
          channel.members.filter((voiceMember) => !voiceMember.user.bot)
            .size === 0
        ) {
          distube.voices.leave(guild.id);
          console.log("Bot opuścił pusty kanał głosowy.");
        }

        leaveTimers.delete(guild.id);
      }, 15000);

      leaveTimers.set(guild.id, timer);
    }
  } catch (error) {
    console.error("Błąd VoiceStateUpdate:", error);
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Nie udało się zalogować bota:", error);
});
