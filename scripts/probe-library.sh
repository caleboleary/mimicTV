#!/usr/bin/env bash
# probe-library.sh: walk media folders and record what mimicTV needs to fake your
# library on another machine. Paths, durations, chapters, and stream info only.
# No media is copied.
#
# Usage:
#   ./probe-library.sh -o library.jsonl [options] [ROOT...]   (no ROOT = current folder)
#
# Options:
#   -o FILE   output file (default: library.jsonl). One JSON line per media file.
#   -n N      stop after N files (quick test run)
#   -r        resume: skip files already present in the output file
#   -j        also gzip the output when done
#   -u URL    upload the result when done (PUT URL/<filename>), e.g. -u http://mac:8765/upload
#
# Requires ffprobe on PATH, or set FFPROBE, e.g.
#   FFPROBE="docker exec -i ersatztv ffprobe" ./probe-library.sh ... (paths must be container paths)
#
# Then copy library.jsonl to the mimicTV machine and load it on the Library page.

set -uo pipefail

FFPROBE="${FFPROBE:-ffprobe}"
OUT="library.jsonl"
LIMIT=0
RESUME=0
GZIP=0
UPLOAD=""

while getopts "o:n:rju:h" opt; do
  case "$opt" in
    o) OUT="$OPTARG" ;;
    n) LIMIT="$OPTARG" ;;
    r) RESUME=1 ;;
    j) GZIP=1 ;;
    u) UPLOAD="${OPTARG%/}" ;;
    h) sed -n '2,20p' "$0"; exit 0 ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -eq 0 ] && set -- .

if ! $FFPROBE -version >/dev/null 2>&1; then
  echo "error: cannot run '$FFPROBE'. Install ffmpeg or set FFPROBE." >&2
  exit 2
fi

ROOTS=()
for root in "$@"; do
  [ -d "$root" ] || { echo "error: not a directory: $root" >&2; exit 2; }
  ROOTS+=( "$(cd "$root" && pwd -P)" )
done
set -- "${ROOTS[@]}"

json_str() {
  # Minimal JSON string escaping for paths we build ourselves.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS=""} {print (NR>1?"\\n":"") $0}' | sed -e 's/^/"/' -e 's/$/"/'
}

DONE_LIST=""
if [ "$RESUME" -eq 1 ] && [ -f "$OUT" ]; then
  DONE_LIST="$(mktemp)"
  sed -n 's/.*"filename": *"\([^"]*\)".*/\1/p' "$OUT" > "$DONE_LIST"
  echo "resuming: $(wc -l < "$DONE_LIST" | tr -d ' ') files already probed" >&2
else
  : > "$OUT"
  roots_json=""
  for root in "$@"; do roots_json="$roots_json${roots_json:+,}$(json_str "$root")"; done
  printf '{"mimictv_probe":1,"generated_at":"%s","host":%s,"roots":[%s]}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_str "$(hostname)")" "$roots_json" >> "$OUT"
fi

EXT_ARGS=( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi' -o -iname '*.mov'
           -o -iname '*.ts' -o -iname '*.m2ts' -o -iname '*.mpg' -o -iname '*.mpeg' -o -iname '*.webm'
           -o -iname '*.wmv' -o -iname '*.flv' -o -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' )

total=0
for root in "$@"; do
  n=$(find "$root" -type f \( "${EXT_ARGS[@]}" \) | wc -l | tr -d ' ')
  total=$((total + n))
done
echo "found $total media files under $# root(s)" >&2

count=0
ok=0
failed=0
skipped=0
start_ts=$(date +%s)

for root in "$@"; do
  root_json="$(json_str "$root")"
  while IFS= read -r -d '' f; do
    if [ "$LIMIT" -gt 0 ] && [ "$ok" -ge "$LIMIT" ]; then break 2; fi
    count=$((count + 1))
    if [ -n "$DONE_LIST" ] && grep -qxF -- "$f" "$DONE_LIST"; then
      skipped=$((skipped + 1)); continue
    fi
    printf '\r[%d/%d] ok=%d failed=%d skipped=%d  %.80s' "$count" "$total" "$ok" "$failed" "$skipped" "${f##*/}" >&2
    probe=$($FFPROBE -v error -print_format json=c=1 -show_format -show_streams -show_chapters -- "$f" 2>/dev/null | tr -d '\n\r')
    if [ -z "$probe" ] || [ "$probe" = "{}" ]; then
      failed=$((failed + 1))
      printf '{"root":%s,"error":"ffprobe failed","filename":%s}\n' "$root_json" "$(json_str "$f")" >> "$OUT"
      continue
    fi
    printf '{"root":%s,"probe":%s}\n' "$root_json" "$probe" >> "$OUT"
    ok=$((ok + 1))
  done < <(find "$root" -type f \( "${EXT_ARGS[@]}" \) -print0 | sort -z)
done

[ -n "$DONE_LIST" ] && rm -f "$DONE_LIST"
elapsed=$(( $(date +%s) - start_ts ))
printf '\ndone: %d probed, %d failed, %d skipped in %ds -> %s (%s)\n' "$ok" "$failed" "$skipped" "$elapsed" "$OUT" "$(du -h "$OUT" | cut -f1)" >&2

SEND="$OUT"
if [ "$GZIP" -eq 1 ]; then
  gzip -kf "$OUT" && echo "gzipped: $OUT.gz" >&2 && SEND="$OUT.gz"
fi

if [ -n "$UPLOAD" ]; then
  name="$(basename "$SEND")"
  echo "uploading $SEND to $UPLOAD/$name ..." >&2
  if command -v curl >/dev/null 2>&1; then
    curl -sf -T "$SEND" "$UPLOAD/$name" >&2 || echo "upload failed" >&2
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O - --method=PUT --body-file="$SEND" "$UPLOAD/$name" >&2 || echo "upload failed" >&2
  else
    echo "upload skipped: neither curl nor wget found" >&2
  fi
fi
