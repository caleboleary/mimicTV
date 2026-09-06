# Installing with Docker

mimicTV and ErsatzTV Next run as two containers that share two folders: your media (read-only) and the folder
mimicTV publishes into, which ErsatzTV Next reads as its `/config`.

## 1. Folders

Pick two host paths:

| Host path | Purpose | mimicTV sees it as | ErsatzTV Next sees it as |
|---|---|---|---|
| your media | shows, commercials, IDs, bumpers, filler | `/media` (read-only) | `/media` (read-only) |
| an empty folder | what mimicTV writes for ErsatzTV Next | `/next` | `/config` |

Mounting the media at the same path in both containers means no path mapping is needed. ErsatzTV Next runs as
user 1000 and writes its stream output under `/config`, so that folder must be writable by uid 1000:

```sh
mkdir -p /path/to/ersatztv-next && chown -R 1000:1000 /path/to/ersatztv-next
```

mimicTV keeps its own state (rules, library, break decisions, checkpoints) in `./data` next to the compose file.
Back that folder up and you have everything.

## 2. Start

```sh
git clone https://github.com/caleboleary/mimicTV.git && cd mimicTV
# edit docker-compose.yml: the two host paths and TZ (both containers must agree on the time zone)
docker compose up -d
docker compose logs -f mimictv
```

Open `http://<host>:8787`.

## 3. First run

1. **Setup → Where your media is.** Add `/media/TV`, `/media/Commercials`, and whatever else you keep (IDs, bumpers, filler), one folder per kind. **Scan everything.**
2. **Setup → Where ErsatzTV Next reads from.** Output folder `/next`. If the box has hardware transcoding, set it under "Video output"; otherwise ErsatzTV Next transcodes in software. **Publish now.** You should see `lineup.json`, `channels/`, and `xmltv/` appear in the folder.
3. **Setup → Where ErsatzTV Next is on your network:** `http://<host>:8409`. That gives you the M3U and XMLTV links in the sidebar and the ▶ preview on the Guide.
4. **Channels → New channel.** Tick a few shows. It goes live at the current half hour.
5. **Restart ErsatzTV Next** (`docker compose restart ersatztv-next`): it reads the lineup only when it starts, so do this after adding or removing a channel.
6. Press ▶ on the Guide, or point a TV app at the M3U and XMLTV links.

## Notes

- **Ports.** If something already listens on 8409 (Legacy ErsatzTV, say), change the host side of the mapping, e.g. `"8410:8409"`; `lineup.json` keeps 8409 inside the container.
- **Live ad breaks** ("pick ads at playback" on a format) need ErsatzTV Next to reach mimicTV: set the resolver URL in Setup to `http://<host>:8787`.
- **Updating.** `git pull && docker compose build mimictv && docker compose up -d`.
- **Media on another machine** is covered in the README: the probe script uploads to `http://<host>:8787/imports/upload`.
