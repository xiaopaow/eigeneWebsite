FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
