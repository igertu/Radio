```js

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

for (const pkg of ["discord.js", "distube", "@discordjs/voice"]) {
    try {
        console.log(
            `WERSJA ${pkg}:`,
            require(`${pkg}/package.json`).version
        );
    } catch (error) {
        console.log(`Nie udało się odczytać wersji ${pkg}:`, error.message);
    }
}

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

const leaveTimers = new Map();

client.once("ready", () => {
    console.log(`Bot muzyczny gotowy jako ${client.user.tag}`);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const member = newState.member;

    // Człowiek wszedł na docelowy kanał
    if (
        newState.channelId === TARGET_VOICE_CHANNEL_ID &&
        oldState.channelId !== TARGET_VOICE_CHANNEL_ID &&
        member &&
        !member.user.bot
    ) {
        const timer = leaveTimers.get(guild.id);

        if (timer) {
            clearTimeout(timer);
            leaveTimers.delete(guild.id);
        }

        const voiceChannel = newState.channel;

        try {
            const queue = distube.getQueue(guild.id);

            if (!queue) {
                console.log("Próba połączenia z kanałem i uruchomienia playlisty...");

                await distube.play(voiceChannel, PLAYLIST_URL, {
                    member,
                    textChannel: guild.systemChannel
                });

                console.log("Playlista została uruchomiona.");
            }
        } catch (error) {
            console.error("Błąd odtwarzania:", error);
        }
    }

    // Sprawdź kanał, na którym aktualnie znajduje się bot
    const botChannel = guild.members.me?.voice.channel;

    if (!botChannel) return;

    const humans = botChannel.members.filter(m => !m.user.bot);

    // Jeśli ktoś jest na kanale, bot nie powinien wychodzić
    if (humans.size > 0) {
        const timer = leaveTimers.get(guild.id);

        if (timer) {
            clearTimeout(timer);
            leaveTimers.delete(guild.id);
        }

        return;
    }

    // Nie uruchamiaj drugiego timera
    if (leaveTimers.has(guild.id)) return;

    console.log("Kanał pusty. Bot odczeka 15 sekund.");

    const timer = setTimeout(() => {
        leaveTimers.delete(guild.id);

        const currentChannel = guild.members.me?.voice.channel;

        if (!currentChannel || currentChannel.id !== botChannel.id) {
            return;
        }

        const currentHumans = currentChannel.members.filter(
            m => !m.user.bot
        );

        if (currentHumans.size === 0) {
            distube.voices.leave(guild.id);
            console.log("Kanał nadal pusty po 15 sekundach. Bot wychodzi.");
        } else {
            console.log("Ktoś wrócił na kanał. Bot zostaje.");
        }
    }, 15000);

    leaveTimers.set(guild.id, timer);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Nie udało się zalogować bota Discord:", error);
});
```
