FROM node:22-alpine

WORKDIR /app

COPY backend/package.json ./package.json
RUN npm install --omit=dev

COPY backend/src ./src
COPY assets ./public/assets
COPY *.html ./public/

EXPOSE 3000

CMD ["npm", "start"]