FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg yt-dlp ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

CMD ["node", "index.js"]
