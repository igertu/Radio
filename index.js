import "dotenv/config";
import { createServer } from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";
import { SpotifyPlugin } from "@distube/spotify";

// Serwer HTTP wymagany przez Render
const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bot Discord działa!");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Serwer HTTP działa na porcie ${PORT}`);
});

// Bot Discord
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

// Konfiguracja
const TARGET_VOICE_CHANNEL_ID = "1325124055627599913";
const PLAYLIST_URL = "https://open.spotify.com/playlist/3DmkMyHBtiSUGdBFeWm3BX?si=1bcc0fb2415b4ce0&pt=96c65f2c032eb1af174a7f500e5a016c";

client.once("ready", () => {
    console.log(`Bot muzyczny gotowy jako ${client.user.tag}`);
});

// Automatyczne odtwarzanie po wejściu użytkownika
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member;

    if (
        newState.channelId === TARGET_VOICE_CHANNEL_ID &&
        oldState.channelId !== TARGET_VOICE_CHANNEL_ID
    ) {
        if (member?.user.bot) return;

        const voiceChannel = newState.channel;

        try {
            const queue = distube.getQueue(guild.id);

            if (!queue) {
                await distube.play(voiceChannel, PLAYLIST_URL, {
                    member,
                    textChannel: guild.systemChannel
                });

                console.log("Bot dołączył do kanału i zaczął odtwarzać muzykę.");
            }
        } catch (error) {
            console.error("Błąd podczas odtwarzania muzyki:", error);
        }
    }

    // Sprawdź, czy kanał bota jest pusty
    const botMember = guild.members.me;
    const botChannel = botMember?.voice.channel;

    if (botChannel) {
        const humanMembers = botChannel.members.filter(
            (m) => !m.user.bot
        );

        if (humanMembers.size === 0) {
            setTimeout(() => {
                const currentChannel = guild.members.me?.voice.channel;

                if (currentChannel?.id === botChannel.id) {
                    const currentHumans = currentChannel.members.filter(
                        (m) => !m.user.bot
                    );

                    if (currentHumans.size === 0) {
                        distube.stop(guild.id);
                        console.log(
                            "Kanał pusty przez 10 sekund — bot wyszedł."
                        );
                    }
                }
            }, 10000);
        }
    }
});

// Logowanie
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Nie udało się zalogować bota Discord:", error);
});
