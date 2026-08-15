FROM node:22-alpine

WORKDIR /app

COPY backend/package.json ./package.json
RUN npm install --omit=dev

COPY backend/src ./src
COPY assets ./public/assets
COPY *.html ./public/
# Search engines fetch these two by exact filename at the site root.
# Without this line they never reach the image and return 404.
COPY robots.txt sitemap.xml ./public/

EXPOSE 3000

CMD ["npm", "start"]