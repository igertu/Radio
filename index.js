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
  console.error("Brak DISCORD_TOKEN w ustawieniach Render!");
  process.exit(1);
}

const TARGET_CHANNEL_ID = "1325124055627599913";

const PLAYLIST_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

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

const startingGuilds = new Set();

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot gotowy jako ${readyClient.user.tag}`);
});

distube.on("error", (error) => {
  console.error("Błąd DisTube:", error.message);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const member = newState.member;

    if (!member || member.user.bot) return;

    // Reaguj tylko na wejście człowieka na wybrany kanał
    if (newState.channelId !== TARGET_CHANNEL_ID) return;

    const guild = newState.guild;
    const botMember = guild.members.me;

    if (!botMember) return;

    // Jeśli bot już jest na kanale, nie uruchamiaj kolejnego odtwarzania
    if (botMember.voice.channelId === TARGET_CHANNEL_ID) {
      console.log("Bot już znajduje się na docelowym kanale.");
      return;
    }

    // Nie uruchamiaj kilku prób jednocześnie
    if (startingGuilds.has(guild.id)) return;

    startingGuilds.add(guild.id);

    try {
      const voiceChannel = newState.channel;

      if (!voiceChannel) return;

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

      console.log(`Bot próbuje wejść na: ${voiceChannel.name}`);

      await distube.play(voiceChannel, PLAYLIST_URL, {
        member,
        textChannel: textChannel ?? undefined,
      });

      console.log("Polecenie odtwarzania playlisty zostało wysłane.");
    } catch (error) {
      console.error("Nie udało się dołączyć lub odtwarzać:", error);
    } finally {
      startingGuilds.delete(guild.id);
    }
  } catch (error) {
    console.error("Błąd obsługi kanału głosowego:", error);
  }
});

client.login(TOKEN).catch((error) => {
  console.error("Błąd logowania Discord:", error);
});
