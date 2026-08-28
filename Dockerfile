FROM node:22-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
# ci rather than install: the lockfile is committed, so every build resolves to
# exactly the versions that were tested.
RUN npm ci --omit=dev

COPY backend/src ./src
# Needed to run `npm run admin-password` inside the running container, which is
# where the password has to be set — the hash never lives in this repository.
COPY backend/scripts ./scripts
# The invoice PDF embeds these; without them no invoice can be issued.
COPY backend/assets ./assets
COPY assets ./public/assets
COPY *.html ./public/
# Search engines fetch these two by exact filename at the site root.
# Without this line they never reach the image and return 404.
COPY robots.txt sitemap.xml ./public/

EXPOSE 3000

CMD ["npm", "start"]