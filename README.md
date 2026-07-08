# ⚡ HUBRIS

*Grow beyond the gods' patience.*

A roguelite that fuses **Hades**' chamber-crawl and god-boon buildcraft with
**Megabonk**'s horde-survival exponential growth. Fight through 10 chambers of
the underworld, stack auto-weapons and tomes, take boons from Zeus, Ares, and
Hermes, and melt the Gatekeeper — or die and spend your Ichor at the Mirror of
Hubris to come back stronger.

Built with TypeScript + Vite + Canvas 2D. **Zero asset files** — all graphics
are procedural and all audio is synthesized with WebAudio.

## Run it

```bash
npm install
npm run dev      # http://localhost:5317 (also reachable on your LAN)
npm run build    # production build in dist/
npm test         # headless balance-regression suite
```

## Deploy / play on your phone

The production build (`npm run build`) is a fully static, self-contained site
in `dist/` with **relative paths** — it runs from any static host or subpath,
no server code needed. It's also a **PWA** (manifest + icons): opened on a
phone, "Add to Home Screen" installs it fullscreen in landscape.

- **Play on your phone right now (same wifi):** run `npm run dev` and open
  `http://<your-mac-ip>:5317` on the phone.
- **Netlify (no CLI needed):** `npm run build`, then drag the `dist/` folder
  onto https://app.netlify.com/drop — you get a public URL in seconds.
- **GitHub Pages:** push the repo, enable Pages for the `dist/` output (or a
  `gh-pages` branch), done — relative base means no config changes.
- **Cloudflare Pages / Vercel / itch.io:** point them at `dist/` (or upload it
  zipped to itch.io as an HTML5 game).
- **Native iPhone/iPad app:** a complete Xcode project lives in
  [`apple/`](apple/README.md) — `npm run build:ios`, open
  `apple/HUBRIS.xcodeproj`, press ⌘R. See its README for the full developer
  & deployment guide (device installs, TestFlight, App Store).

**Touch controls** (appear on first touch): left half = virtual move stick
(anchors where your thumb lands), right half = aim stick that fires while
held, plus an on-screen dash button. On touch devices, fresh saves default
**auto-aim + auto-fire ON**, so mobile play is steer-dash-choose out of the
box. Menus and cards are tap-friendly and fit small/landscape screens.

## Controls

| Input | Action |
|---|---|
| **WASD / arrows** | move |
| **Mouse** | aim · hold **LMB** to strike (parries projectiles) |
| **Space / Shift** | dash (invulnerable during) |
| **1 / 2 / 3, R** | pick / reroll upgrade cards |
| **Tab** | build panel |
| **Esc** | pause |

## The loop

0. **Choose your shade** — three characters with distinct basic attacks and
   passives: **The Exile** (sweeping sword combo that parries projectiles,
   +20 max HP), **The Huntress** (long-range piercing arrows, triple volley
   every 3rd shot, +50% pickup radius), and **The Oracle** (exploding
   spell-orbs with a surge every 3rd cast, plus a regenerating **mana
   shield** that soaks damage before HP).
1. Each chamber continuously spawns a horde — fill the **kill quota**. Melee
   strikes are a **3-hit combo** (the finisher hits harder); brutes telegraph
   their charges, ranged foes flash before firing.
   **Obelisks** (Megabonk-style shrines) spawn from chamber 2: stand in the
   ring to channel a capture while a defense wave contests you — rewards range
   from timed damage/haste/gold surges to lightning storms, heals, and
   soul-bursts. Edge-of-screen arrows point the way. **Chests** also hide
   around the arena — free ones grant an upgrade; gilded ones cost gold and
   grant two. Magenta **Altars of Fate** (from chamber 3) are a gamble:
   capturing one rolls a random *run-long* modifier — a blessing (+damage,
   +attack speed, +HP…), a bane (tougher or faster enemies, −HP…), or a
   double-edged pact like Glass Cannon or Midas Curse. Your accepted fates are
   listed in the build panel (Tab).
2. Enemies drop XP gems → level-ups mid-combat → pick **auto-weapons** (11,
   each with 7 levels; max level **Transcends**) and **tomes** (12 passives).
   Four weapons are earned via **lifetime quests** (see the Arsenal screen).
3. Cleared chambers open **doors with visible rewards**: god boons, gold,
   healing, XP caches, Ichor, chests, the **Forge** (a guaranteed weapon
   level), **Charon's Wares** (a gold shop), and **Poms of Power** (raise an
   owned boon's rarity).
4. **Boons** from four gods — Zeus, Ares, Hermes, and **Poseidon** (knockback,
   wall-slams, Chill) — roll rarities (Common/Rare/Epic, luck-weighted);
   holding boons from two gods can unlock one of **six Duo boons**.
5. Damage bonuses live in **brackets** — additive within a bracket,
   multiplicative across brackets (Might × source × frenzy × vulnerability ×
   crit). Diversify to go exponential.
6. From chamber 6 the run descends into **the Ember Court** — new palette, new
   music, and weavers. Elites carry affixes: **splitter**, **warded**,
   **burning**.
7. The run is **20 chambers**. A **major boss guards every 5th**: a herald at
   chamber 5, **both bosses at once** at chamber 10 (the Twin Gates barrier),
   a lone gate at 15, and the **Final Gates** at 20 — the Gatekeeper *and*
   the Shepherd of Shades together, near full strength. Every conquered boss
   chamber bestows a guaranteed **Legendary boon** (unique god powers: a
   living storm, undying Bloodlust, divine dash celerity, King Tide waves).
   Win, then **descend deeper** — endless chambers with a boss every five —
   or return home.
8. Win or lose, **Ichor** is permanent — spend it in the **Mirror of Hubris**:
   18 permanent modifiers including armor, crit, run head-starts (levels,
   gold, boons), a 4th boon choice, longer obelisk buffs, shop discounts, and
   double Death Defiance. After your first escape, the **Pact of Punishment**
   adds heat modifiers for bonus ichor.
9. Each character has **unlockable skins** earned through character-specific
   feats (kill counts, chamber depth, Gatekeeper kills) — pick them from the
   swatches on the character-select screen.

## Extras

- **Gamepad**: sticks move/aim, A/RT strike, B/RB dash, Start pause. Menus are
  fully navigable too: D-pad/stick to move focus, A select, B back, X reroll.
- **Save data**: all meta progress (Mirror, ichor, unlocks, heat, settings,
  lifetime stats) persists in browser localStorage across restarts. It is tied
  to the browser + origin (host:port), so Settings → SAVE DATA offers
  **Copy/Import save code** to back up progress or move it between browsers or
  ports, and **Wipe save data** (double-confirm) for a fresh start.
- **Settings**: volume sliders, screen-shake and damage-number reduction.
- **Accessibility**: **auto-aim** (locks aim to the nearest enemy) and
  **auto-fire** (attacks whenever a target is in your character's reach) can
  be toggled independently in Settings — with both on, combat is fully
  hands-free and you only steer, dash, and choose upgrades.
- **Tests**: `npm test` runs a headless balance-regression suite (the full sim
  runs in Node via [src/testkit.ts](src/testkit.ts)).

See [GAME_DESIGN.md](GAME_DESIGN.md) for the full design doc and the research
on both source games.
