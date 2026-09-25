FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production LISTEN_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
# Mount points for the private contact database and call reports (owned by uid 1000).
RUN mkdir -p .private reports && chown node:node .private reports
USER node
EXPOSE 3000 3001
CMD ["node", "src/server.mjs"]
