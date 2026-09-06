import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * In-app docs: the happy path for someone setting mimicTV up next to ErsatzTV Next for the first time.
 * Short on purpose; every section is a couple of paragraphs and a "next" pointer.
 */
const SECTIONS: { id: string; title: string; body: JSX.Element }[] = [
  {
    id: 'start', title: 'How it fits together', body: (
      <>
        <p><b>ErsatzTV Next</b> plays video and serves the stream your TV apps watch. It has no idea what a show or a commercial is: it reads a plain list of "play this file from here to there" and does exactly that.</p>
        <p><b>mimicTV</b> writes that list. It scans your media, lets you describe channels the way a broadcaster would (shows, a format, breaks), decides what plays when, and keeps a few days of schedule written ahead. Change a channel and its future re-flows from the next break; what's playing right now never changes.</p>
        <p>The happy path is four steps, each its own page: <Link to="/setup">Setup</Link> scans and publishes, <Link to="/library">Library</Link> is what you have, <Link to="/channels">Channels</Link> is what you build, <Link to="/guide">Guide</Link> is what's on.</p>
      </>
    ),
  },
  {
    id: 'setup', title: 'Setup: folders, output, address', body: (
      <>
        <p><b>1. Where your media is.</b> Add each top-level folder: shows, commercials, network IDs, bumpers, filler. Keep those as separate folders; the kind is guessed from the folder name and you can correct it per folder. Press <b>Scan everything</b>. It runs ffprobe over each file (durations, chapters, stream facts) and nothing is modified. Later, <b>Scan this</b> beside a folder refreshes just that one.</p>
        <p><b>2. Where ErsatzTV Next reads from.</b> A folder mimicTV writes into: <code>lineup.json</code>, one folder per channel, and an <code>xmltv</code> folder for the guide. Point ErsatzTV Next at that <code>lineup.json</code>. If ErsatzTV Next sees your media at a different path than mimicTV scanned (a different mount), add a path mapping so the written paths are the ones it can open.</p>
        <p><b>3. Where ErsatzTV Next is on your network</b>, e.g. <code>http://192.168.1.10:8409</code>. This gives you the M3U and XMLTV links in the sidebar and the ▶ preview on the Guide.</p>
        <p>Then <b>Publish now</b>. mimicTV keeps topping the files up on its own after that (every few hours, and a few seconds after any edit).</p>
        <p className="muted small">ErsatzTV Next reads the lineup only when it starts: restart it after adding or removing a channel.</p>
      </>
    ),
  },
  {
    id: 'library', title: 'Library: shows, folders, collections', body: (
      <>
        <p>Everything the scan found, by kind. <b>Shows</b> lists each series with episode counts and how many episodes have break points. <b>Folders</b> is every folder two levels down from your roots; <b>Hide</b> keeps a folder out of every channel, preview, and publish without touching the files, and it stays hidden through rescans until you press <b>Show again</b>.</p>
        <p><b>Collections</b> are pools shared across channels: a saved search like "commercials from the 90s folder" or "all network IDs". A channel can make one of its private pools shared, or copy a shared one to tweak privately.</p>
        <p>Not a scan file? Files are never edited, tagged, or moved. If a title looks wrong, it comes from the file or folder name.</p>
      </>
    ),
  },
  {
    id: 'channels', title: 'Channels: shows, format, breaks', body: (
      <>
        <p><b>New channel</b> gives you a working half-hour format; you pick the shows. A channel is blank until at least one show is ticked, then it starts at the current half hour: no invented history.</p>
        <p><b>Shows.</b> Tick what this channel draws from. "Shuffle shows, episodes in order" is the classic cable feel: a random show each slot, every show working through its episodes in order. The length range and "skip extras" keep stray files off the air.</p>
        <p><b>Format.</b> The shape of each slot: how long the content is, where the breaks fall (the episode's own break points, or every N minutes when it has none), whether breaks are equalized, and what pads the slot out to the half hour. Presets cover the usual shapes; "Customize" opens every knob.</p>
        <p><b>Breaks.</b> Commercials first, filler to pad, a network ID last when the break lands near :00 or :30. Each is a pool. Bumpers ("we'll be right back") and per-show ad overrides live underneath.</p>
        <p><b>Time bands</b> change the format at certain hours: cartoons in the morning, dramas at night. A <b>fixed show</b> is an appointment that plays at its time every day. <b>Duplicate</b> copies a channel so a second one is a swap of shows away; <b>Mirror</b> makes an east/west feed of another channel a few hours later.</p>
        <p>The right-hand day preview re-flows as you edit. Click a block to see exactly what it holds and why.</p>
      </>
    ),
  },
  {
    id: 'recipes', title: 'Recipes', body: (
      <>
        <p className="muted small">Channel setups people ask for, and where each lives. Every one starts with New channel and a few ticked shows.</p>
        <h3>The basics</h3>
        <p><b>A cartoon block: shuffled shows, each in episode order, ads at the chapter marks, IDs near the hour, padded to the half hour.</b><br />That is the default. The Half-hour show preset does it: 22 minutes of content, breaks at the break points (or every 8 minutes when an episode has none), an ID when a break lands near :00 or :30, filler to the next :30.</p>
        <p><b>One show, start to finish, in order.</b><br />Tick one show. Under Shows, set the order to Sequential. For hour-long episodes pick the Hour drama preset.</p>
        <p><b>Two shows strictly alternating.</b><br />Tick exactly two shows with the default "Shuffle shows, episodes in order". A shuffle never repeats the show that just played.</p>
        <p><b>Two episodes of a show, then switch.</b><br />Shows → More options → Episodes of a show in a row.</p>
        <p><b>Only seasons 1 to 3.</b><br />Shows → More options → Only seasons. The length range and "skip extras" beside it keep specials and stray files off the air.</p>
        <p><b>Sitcoms back to back, no ads, no padding.</b><br />Format → Back to back. Each episode starts when the last one ends.</p>
        <p><b>Movies with a break every 25 minutes.</b><br />Format → Movies. Customize changes the interval or sets fixed offsets.</p>
        <p><b>Music videos with a bumper every four clips.</b><br />Format → Music videos. Customize → Between stacked programs changes the count.</p>
        <h3>Time of day</h3>
        <p><b>Cartoons in the morning, sitcoms in the evening, movies late.</b><br />Schedule → + time band at each hour the format changes. Each band has its own shows, format, and breaks; click a band to edit it.</p>
        <p><b>Off air overnight: a static card or test pattern only.</b><br />Add a band at, say, 02:00 and give it the Off air format. Only the filler pool plays.</p>
        <p><b>The Simpsons at 6pm every day, whatever else is going on.</b><br />Schedule → + fixed show. Set its time and length, then choose the show under Shows. The shows around it make room and the day resumes afterwards.</p>
        <p><b>Saturday-morning-only cartoons.</b><br />On that band, open "Only on certain days" and tick Sat (and Sun). Other days, the surrounding band covers the time.</p>
        <p><b>Holiday specials only in December.</b><br />On a band, Only on certain days → Between 12-01 and 12-31 (a window can wrap the year end). Give the band a show pool of the specials.</p>
        <p><b>East and West feeds: the same channel three hours later.</b><br />Make the second channel, then Identity → Mirror another channel, pick the source and the offset. A mirror has no recipe of its own.</p>
        <h3>Breaks and branding</h3>
        <p><b>A channel bug on shows, off during commercials.</b><br />Format → Customize → Branding: tick Channel bug and set the image path.</p>
        <p><b>A bumper going into every break and another coming out.</b><br />Breaks → Bumpers: a pool for "Going into a break" and one for "Coming out of a break" (that one plays last, after the network ID).</p>
        <p><b>"Coming up next" after every programme.</b><br />Breaks → Bumpers → When a show ends. Only in the break after a programme finishes, not at chapter cuts inside one.</p>
        <p><b>Ads themed to the era of the show playing.</b><br />Make a commercial collection per era in Library → Collections, then Breaks → Different ads for some shows: the shows and the pool to use while they are on.</p>
        <p><b>Commercials that do not repeat across channels.</b><br />On the commercial pool, More options → Count plays on other channels too. Use a shared collection so every channel draws from the same pool.</p>
        <p><b>Pick the ads live, at playback.</b><br />Format → Customize → Pick ads at playback. Each break becomes a placeholder ErsatzTV Next resolves by asking mimicTV during the break. Needs the resolver URL in Setup.</p>
        <h3>Fixing a running channel</h3>
        <p><b>Replicate a channel with different shows.</b><br />Channels → Duplicate, then swap the shows. The copy gets its own seed, so the order differs while the shape stays.</p>
        <p><b>Start a show over, or jump to S03E01.</b><br />Shows → Where each show is: Start over, or jump to an episode. Takes effect from the next published break.</p>
        <p><b>Start the whole channel over from now.</b><br />Identity → Restart from now. History is forgotten and it begins again at the current half hour; whatever is playing is cut off.</p>
      </>
    ),
  },
  {
    id: 'breaks', title: 'Where the ads go inside an episode', body: (
      <>
        <p>An ad break in the middle of an episode needs a break point: an offset in the file where the show fades out. Files sometimes carry these as chapters, but chapters that came with a download are usually scene marks, not breaks, and every one of them would become an ad. Library → Shows shows what each series is running on.</p>
        <p>Open a show's <b>Breaks</b> page and press <b>Analyze</b>. mimicTV watches each episode for the fades to black that shows use around commercials and lines them up across the season ("breaks at ~7:05 and ~14:30 in 22/24 episodes"). It takes a minute or two per episode of video and runs in the background.</p>
        <p>Then check the picks: each episode is a bar, grey ticks are fades it found, gold marks are the breaks it chose. Click a tick to use it, a mark to drop it, and <b>Save</b>. If a show just won't cooperate, choose timed breaks (every N minutes from the format), no breaks, or place them by hand. Decisions are stored by mimicTV; your video files are never written to.</p>
      </>
    ),
  },
  {
    id: 'guide', title: 'Guide: what is on', body: (
      <>
        <p>Every channel for a day, side by side, exactly as published. The red line is now. Hover a programme for the episode; darker bands inside it are its breaks. Click to inspect the block. Drag the strip or the box under it to move along the day; drag the box's edges or ctrl+wheel to zoom.</p>
        <p>▶ beside a channel plays it right here, from ErsatzTV Next. It starts transcoding on the first viewer, so give it 10–20 seconds.</p>
      </>
    ),
  },
  {
    id: 'watch', title: 'Watching on a TV', body: (
      <>
        <p>ErsatzTV Next serves an M3U playlist and an XMLTV guide; the sidebar has both links with copy buttons once its address is set. Point Plex, Jellyfin, Emby, or any IPTV app (Tivimate, IPTVnator, VLC…) at the M3U for channels and the XMLTV for the guide.</p>
        <p>Each channel's stream URL is <code>{'<ErsatzTV Next>/channel/<number>.m3u8'}</code>, and VLC can open that directly.</p>
      </>
    ),
  },
  {
    id: 'faq', title: 'When something looks off', body: (
      <>
        <p><b>The Guide and my TV disagree.</b> They shouldn't: the Guide shows the published timeline. If they do, publish from Setup and reload the Guide.</p>
        <p><b>A new channel plays nothing.</b> Either no show is ticked yet, or ErsatzTV Next hasn't been restarted since the channel was added.</p>
        <p><b>Ads every three minutes.</b> The files carry scene chapters. Open the show's Breaks page and analyze, or pick timed breaks.</p>
        <p><b>I want a channel to start over.</b> <b>Restart from now</b> in the channel editor forgets its history and begins again at the current half hour. "Start over" on a single show resets that show's episode cursor from the next break.</p>
        <p><b>Where is everything saved?</b> In the service's <code>data</code> folder as plain JSON: rules, library, break decisions, checkpoints. Back that folder up and you have everything.</p>
      </>
    ),
  },
];

export default function HelpPage() {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(`help-${s.id}`)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id.replace('help-', '')); }, { rootMargin: '-10% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <div>
      <div className="toolbar"><h1>Help</h1><span className="muted small">the happy path, start to finish</span></div>
      <div className="docs">
        <nav className="docs-toc">
          {SECTIONS.map((s) => <a key={s.id} href={`#help-${s.id}`} className={active === s.id ? 'on' : ''}>{s.title}</a>)}
        </nav>
        <div className="docs-body">
          {SECTIONS.map((s) => (
            <section key={s.id} id={`help-${s.id}`} className="panel docs-section">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
