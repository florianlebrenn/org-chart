# --- Étape 1 : build de l'app React (Vite) ---
FROM node:26-alpine AS build
WORKDIR /app
# aucune télémétrie, même à l'installation des paquets
ENV DO_NOT_TRACK=1 SCARF_ANALYTICS=false NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- Étape 2 : fichiers statiques servis par nginx, sans les droits root ---
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
