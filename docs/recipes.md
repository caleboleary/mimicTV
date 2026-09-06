# Recipes

Channel setups people ask for, and where each one lives in the app. Every recipe starts the same way: **Channels → New channel**, tick some shows, and the day preview on the right fills in. Everything below is one or two extra clicks from there. Each recipe is also a test in `packages/core/test/scenarios.test.ts`, so they stay true.

## The basics

**A cartoon block: shuffled shows, each in episode order, ads at the chapter marks, IDs near the hour, padded to the half hour.**
That's the default. New channel, tick the shows, done. The **Half-hour show** format preset does the rest: 22 minutes of content, breaks at the episode's break points (or every 8 minutes when it has none), a network ID when a break lands near :00 or :30, and filler to the next :30.

**One show, start to finish, in order.**
Tick one show. Under Shows, set the order to **In order**. For hour-long episodes pick the **Hour drama** preset.

**Two shows strictly alternating.**
Tick exactly two shows with the default **Shuffle shows, episodes in order**. A shuffle never repeats the show that just played, so with two they alternate.

**Two episodes of a show, then switch.**
Shows → **More options** → **Episodes of a show in a row**: 2 (or 3, or 4).

**Only seasons 1 to 3.**
Shows → **More options** → **Only seasons**: first 1, last 3. The length range and "skip extras" next to it keep specials and stray files off the air.

**Sitcoms back to back, no ads, no padding.**
Format → **Back to back**. Each episode starts when the last one ends, like a streaming queue.

**Movies with a break every 25 minutes.**
Format → **Movies**. One film per slot, a break every 25 minutes unless the file has chapters, padded to the next :30. **Customize** changes the interval or sets fixed offsets.

**Music videos with a bumper every four clips.**
Format → **Music videos**. Clips stack to fill a half hour with a short break after every four. **Customize → Between stacked programs** changes the count.

## Time of day

**Cartoons in the morning, sitcoms in the evening, movies late.**
Schedule → **+ band** at each hour the format changes. Each band has its own shows, format, and breaks; click a band to edit it. The last band of the day runs until the first one starts again.

**Off air overnight: a static card or test pattern only.**
Add a band at, say, 02:00 and give it the **Off air** format. Only the filler pool plays: no shows, no ads, no IDs.

**The Simpsons at 6pm every day, whatever else is going on.**
Schedule → **+ fixed show**. Set its time and length, then choose the show in the Shows section. It plays at its time every day; the shows around it make room and the day resumes afterwards.

**Saturday-morning-only cartoons.**
On that band, open **Only on certain days** and tick Sat (and Sun). The band is skipped on other days and the surrounding band covers the time.

**Holiday specials only in December.**
On a band, **Only on certain days → Between** 12-01 and 12-31 (a window can wrap the year end, e.g. 12-20 to 01-05). Give the band a show pool of the specials.

**East and West feeds: the same channel three hours later.**
Make the second channel, then Identity → **Mirror another channel**, pick the source and the offset. A mirror plays exactly what its source played, that many hours later, and has no recipe of its own.

## Breaks and branding

**A channel bug on shows, off during commercials.**
Format → **Customize → Branding**: tick **Channel bug**, set the image path. It's drawn on programme items and left off break items.

**A bumper going into every break and another coming out.**
Breaks → **Bumpers**: pick a pool for *Going into a break* and one for *Coming out of a break* (that one plays last, after the network ID).

**"Coming up next" after every programme.**
Breaks → **Bumpers → When a show ends**. It plays only in the break after a programme finishes, not at chapter cuts inside one.

**Ads themed to the era of the show playing.**
Make a commercial collection per era in Library → Collections (a saved search on a folder or a word in the title works well). Then Breaks → **Different ads for some shows**: list the shows and the pool to use while they're on. The channel's main commercial pool covers everything else.

**Commercials that don't repeat across channels.**
On the commercial pool, **More options → Count plays on other channels too**. The no-repeat window then looks at every channel's recent plays, not only this one's. Use a shared collection so all channels draw from the same pool.

**Pick the ads live, at playback.**
Format → **Customize → Pick ads at playback**. Each break is written as a placeholder that ErsatzTV Next resolves by asking mimicTV during the break, so the newest commercials and the freshest no-repeat state are used. Needs the resolver URL in Setup (an address ErsatzTV Next can reach mimicTV on).

## Fixing a running channel

**Replicate a channel with different shows.**
Channels → **Duplicate**, then swap the shows. Everything else is copied; the new channel gets its own seed, so the order differs while the shape stays.

**Start a show over, or jump to S03E01.**
Shows → **Where each show is** lists every show's next episode. **Start over** or **jump to…** an episode. The change takes effect from the channel's next published break.

**Start the whole channel over from now.**
Identity → **Restart from now** forgets the channel's history and begins again at the current half hour. Whatever is playing on it is cut off.
