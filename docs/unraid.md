# Running mimicTV next to ErsatzTV Next on Unraid

A dev setup, not a release: the repo is bind-mounted into a container that has Node, ffmpeg, git, and Claude Code, so you can iterate on the box with real data. Next runs beside it from its official image.

## Layout on the box

| Host path | Purpose | Mounted in mimicTV as | Mounted in Next as |
|---|---|---|---|
| `/mnt/user/appdata/mimictv/repo` | this repo, including `data/` | `/app` | |
| `/mnt/user/appdata/mimictv/home` | Claude Code login, shell history | `/root` | |
| `/mnt/user/media` | your media (read-only) | `/media` | `/media` |
| `/mnt/user/appdata/ersatztv-next` | what mimicTV publishes | `/next` | `/config` |

Media is mounted at the same path in both containers, so no path mapping is needed. Next runs as user 1000 and writes its HLS output under `/config`, so that folder must be writable by uid 1000.

## One-time setup

From an Unraid terminal:

```sh
mkdir -p /mnt/user/appdata/mimictv/home /mnt/user/appdata/ersatztv-next
cd /mnt/user/appdata/mimictv
git clone https://github.com/caleboleary/mimicTV.git repo
chown -R 1000:1000 /mnt/user/appdata/ersatztv-next
```

Edit `repo/docker-compose.yml` if your media share or timezone differ. Then, with the Compose Manager plugin or plain `docker compose`:

```sh
cd /mnt/user/appdata/mimictv/repo
docker compose build mimictv
docker compose up -d mimictv
docker logs -f mimictv-dev      # first start installs dependencies, then runs app + service
```

Without compose, the equivalent `docker run`:

```sh
docker build -t mimictv-dev repo/docker -f repo/docker/Dockerfile.dev
docker run -d --name mimictv-dev --restart unless-stopped \
  -p 5173:5173 -p 8787:8787 -e TZ=America/Chicago \
  -v /mnt/user/appdata/mimictv/repo:/app \
  -v /mnt/user/appdata/mimictv/home:/root \
  -v /mnt/user/media:/media:ro \
  -v /mnt/user/appdata/ersatztv-next:/next \
  mimictv-dev
```

Open `http://<unraid-ip>:5173` from any machine on the network.

## First real loop

1. **Library.** Remove the dummy interstitials on the Library page if they're still there. They point at files that don't exist.
2. **Scan.** Setup, add `/media/TV`, `/media/commercials`, and whatever else you keep (ids, bumpers, filler). Scan now. This is real ffprobe inside the container, so no probe script and no upload.
3. **Publish.** Setup, output folder `/next`. Set the hardware accel field if the box has Quick Sync or similar, otherwise Next transcodes 1080p in software. Publish now. You should see `lineup.json`, `channels/`, and `xmltv/` under `/mnt/user/appdata/ersatztv-next`.
4. **Next.** `docker compose up -d ersatztv-next`. It reads `/config/lineup.json`. Watch `docker logs -f ersatztv-next` for the first channel to start.
5. **Watch.** `http://<unraid-ip>:8409/channel/1.m3u8` in VLC first. Then point Plex, Jellyfin, or an IPTV app at Next's M3U and XMLTV.

The service tops the playout up every six hours and republishes a few seconds after any channel edit. Both are settings.

## Iterating on the box

```sh
docker exec -it mimictv-dev claude
```

Log in once; the login persists in the `home` mount. The container sees the real library, the published output, and Next's logs (`docker logs ersatztv-next` from the host, or mount the Docker socket if you want them inside). Commit from inside the container. Set your name and email first:

```sh
docker exec -it mimictv-dev git config --global user.name "Caleb"
docker exec -it mimictv-dev git config --global user.email "you@example.com"
```

## Things to know

- The image tag `latest` for `ghcr.io/ersatztv/next` is a guess at their naming; check the package page if it fails to pull, and pin a tag once one works.
- `data/` lives inside the repo mount, so state survives container rebuilds and `git pull`. It's ignored by git.
- Times in published files carry the container's timezone offset. Keep `TZ` the same in both containers and matching the box.
- Live ad breaks need Next to reach the service. Set the resolver URL on Setup to `http://<unraid-ip>:8787`.
- Next re-reads playout files on every lookup and mimicTV writes them atomically, so publishing while a channel is playing is safe.
