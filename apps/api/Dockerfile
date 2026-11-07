FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build --workspace=@ai-closet/api
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
ENV NODE_ENV=production PORT=8080
CMD ["node", "dist/index.js"]
