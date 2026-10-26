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
    plugins: [new SpotifyPlugin()]
});

// --- TUTAJ WPISUJESZ SWOJE DANE ---
const TARGET_VOICE_CHANNEL_ID = "1325124055627599913";
const PLAYLIST_URL = "https://open.spotify.com/playlist/3DmkMyHBtiSUGdBFeWm3BX?si=1bcc0fb2415b4ce0&pt=96c65f2c032eb1af174a7f500e5a016c";
// ---------------------------------

client.once("ready", () => {
    console.log(`Bot muzyczny gotowy jako ${client.user.tag}`);
});

// Nasłuchiwanie wejść i wyjść z kanałów głosowych
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member;
    const botMember = guild.members.me;

    // 1. SPRAWDZANIE WEJŚCIA NA KANAŁ GŁÓWNY
    if (newState.channelId === TARGET_VOICE_CHANNEL_ID && oldState.channelId !== TARGET_VOICE_CHANNEL_ID) {
        if (member && member.user.bot) return; // Ignorujemy inne boty

        const voiceChannel = newState.channel;

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

    // 2. SPRAWDZANIE CZY NIKOGO NIE MA NA KANALE BOTA
    if (botMember && botMember.voice.channel) {
        const botChannel = botMember.voice.channel;
        
        // Liczymy użytkowników na kanale bota (odliczając samego bota)
        const humanMembers = botChannel.members.filter(m => !m.user.bot);

        // Jeśli na kanale nie ma żadnego użytkownika (zostali sami boty lub pustka)
        if (humanMembers.size === 0) {
            setTimeout(() => {
                // Sprawdzamy jeszcze raz po 10 sekundach, czy na pewno nikogo nie ma
                const currentChannel = guild.members.me.voice.channel;
                if (currentChannel && currentChannel.id === botChannel.id) {
                    const checkHumans = currentChannel.members.filter(m => !m.user.bot);
                    if (checkHumans.size === 0) {
                        distube.stop(guild.id); // Zatrzymuje muzykę i wychodzi z kanału
                        console.log("Nikogo nie było na kanale przez 10 sekund – bot wyszedł.");
                    }
                }
            }, 10000); // 10 sekund opóźnienia, żeby bot nie wychodził przy chwilowej zmianie kanału
        }
    }
});

// Logowanie bota
client.login(process.env.DISCORD_TOKEN);
