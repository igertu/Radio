
import "dotenv/config";
import { createServer } from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";
import { SpotifyPlugin } from "@distube/spotify";

const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });
    res.end("Bot Discord działa!");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Serwer HTTP działa na porcie ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SpotifyPlugin()]
});

const TARGET_VOICE_CHANNEL_ID = "1325124055627599913";
const PLAYLIST_URL =
    "https://open.spotify.com/playlist/3DmkMyHBtiSUGdBFeWm3BX?si=1bcc0fb2415b4ce0&pt=96c65f2c032eb1af174a7f500e5a016c";

// Opóźnienie wychodzenia — osobny timer dla każdego serwera
const leaveTimers = new Map();

client.once("ready", () => {
    console.log(`Bot muzyczny gotowy jako ${client.user.tag}`);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member;

    // Użytkownik wszedł na docelowy kanał
    if (
        newState.channelId === TARGET_VOICE_CHANNEL_ID &&
        oldState.channelId !== TARGET_VOICE_CHANNEL_ID &&
        !member?.user.bot
    ) {
        // Anuluj planowane wyjście
        const timer = leaveTimers.get(guild.id);
        if (timer) {
            clearTimeout(timer);
            leaveTimers.delete(guild.id);
        }

        const voiceChannel = newState.channel;

        try {
            const queue = distube.getQueue(guild.id);

            if (!queue) {
                await distube.play(voiceChannel, PLAYLIST_URL, {
                    member,
                    textChannel: guild.systemChannel
                });
                console.log("Uruchomiono playlistę.");
            }
        } catch (error) {
            console.error("Błąd odtwarzania:", error);
        }
    }

    // Sprawdź, czy bot jest na kanale głosowym
    const botChannel = guild.members.me?.voice.channel;
    if (!botChannel) return;

    // Jeśli ktoś jest na kanale, anuluj timer
    const humans = botChannel.members.filter(m => !m.user.bot);

    if (humans.size > 0) {
        const timer = leaveTimers.get(guild.id);
        if (timer) {
            clearTimeout(timer);
            leaveTimers.delete(guild.id);
        }
        return;
    }

    // Nie ustawiaj wielu timerów dla tego samego serwera
    if (leaveTimers.has(guild.id)) return;

    const timer = setTimeout(() => {
        leaveTimers.delete(guild.id);

        const currentChannel = guild.members.me?.voice.channel;
        if (!currentChannel || currentChannel.id !== botChannel.id) return;

        const currentHumans = currentChannel.members.filter(
            m => !m.user.bot
        );

        if (currentHumans.size === 0) {
            distube.voices.leave(guild.id);
            console.log("Kanał pusty przez 15 sekund — bot wyszedł.");
        }
    }, 15000);

    leaveTimers.set(guild.id, timer);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Nie udało się zalogować bota Discord:", error);
});
