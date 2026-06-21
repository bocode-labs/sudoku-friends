FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["npm", "start"]
