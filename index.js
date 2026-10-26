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

// Konfiguracja DisTube wraz z wtyczką Spotify
const distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnStop: false,
    plugins: [new SpotifyPlugin()]
});

// --- KONFIGURACJA ---
const TARGET_VOICE_CHANNEL_ID = "TUTAJ_WPISZ_ID_KANALU_GLOWNEGO";
const PLAYLIST_URL = "TUTAJ_WKLEJ_LINK_DO_PLAYLISTY_SPOTIFY_LUB_YT";
// --------------------

client.once("ready", () => {
    console.log(`Bot muzyczny zalogowany jako ${client.user.tag}`);
});

// Nasłuchiwanie wejścia użytkownika na kanał
client.on("voiceStateUpdate", async (oldState, newState) => {
    // Sprawdzamy, czy użytkownik dołączył do docelowego kanału głównego (a nie z niego wyszedł)
    if (newState.channelId === TARGET_VOICE_CHANNEL_ID && oldState.channelId !== TARGET_VOICE_CHANNEL_ID) {
        const member = newState.member;
        if (member.user.bot) return; // Ignorujemy boty

        const voiceChannel = newState.channel;
        const guild = newState.guild;

        try {
            // Sprawdzamy, czy bot już coś gra na tym serwerze
            const queue = distube.getQueue(guild.id);
            if (!queue) {
                // Bot dołącza do kanału i zaczyna odtwarzać playlistę
                await distube.play(voiceChannel, PLAYLIST_URL, {
                    member: member,
                    textChannel: guild.systemChannel // Kanał tekstowy do powiadomień (opcjonalnie)
                });
                console.log(`Bot dołączył do kanału i odtwarza playlistę.`);
            }
        } catch (error) {
            console.error("Wystąpił błąd podczas uruchamiania muzyki:", error);
        }
    }

    // Opcjonalnie: Jeśli wszyscy wyszli z kanału, bot może się rozłączyć
    const botVoiceChannel = guild?.members.me?.voice.channel;
    if (botVoiceChannel && botVoiceChannel.id === TARGET_VOICE_CHANNEL_ID) {
        if (botVoiceChannel.members.size <= 1) { // Został tylko bot
            setTimeout(() => {
                const currentQueue = distube.getQueue(guild.id);
                if (currentQueue && botVoiceChannel.members.size <= 1) {
                    distube.stop(guild.id);
                    console.log("Kanał pusty – bot opuszcza kanał.");
                }
            }, 60000); // Czeka minutę przed wyjściem, jeśli nikogo nie ma
        }
    }
});

client.login(process.env.MUSIC_BOT_TOKEN);
