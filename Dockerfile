FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
RUN npx playwright install --with-deps chromium
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
