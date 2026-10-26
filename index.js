import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";
import { SpotifyPlugin } from "@distube/spotify";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Konfiguracja odtwarzacza DisTube
const distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnStop: false,
    plugins: [new SpotifyPlugin()]
});

// --- TUTAJ WPISUJE SWOJE DANE ---
const TARGET_VOICE_CHANNEL_ID = "WPISZ_TUTAJ_ID_KANALU_GLOWNEGO";
const PLAYLIST_URL = "WPISZ_TUTAJ_LINK_DO_PLAYLISTY_SPOTIFY";
// ---------------------------------

client.once("ready", () => {
    console.log(`Bot muzyczny gotowy jako ${client.user.tag}`);
});

// Nasłuchiwanie wejść na kanał głosowy
client.on("voiceStateUpdate", async (oldState, newState) => {
    // Sprawdzamy czy użytkownik wszedł na docelowy kanał główny
    if (newState.channelId === TARGET_VOICE_CHANNEL_ID && oldState.channelId !== TARGET_VOICE_CHANNEL_ID) {
        const member = newState.member;
        if (member.user.bot) return; // Ignorujemy inne boty

        const voiceChannel = newState.channel;
        const guild = newState.guild;

        try {
            const queue = distube.getQueue(guild.id);
            if (!queue) {
                // Dołącz i graj playlistę
                await distube.play(voiceChannel, PLAYLIST_URL, {
                    member: member,
                    textChannel: guild.systemChannel
                });
                console.log("Bot dołączył do kanału i zaczął odtwarzać muzykę.");
            }
        } catch (error) {
            console.error("Błąd podczas odtwarzania muzyki:", error);
        }
    }
});

// Logowanie bota przy użyciu zmiennej środowiskowej z Rendera
client.login(process.env.DISCORD_TOKEN);
