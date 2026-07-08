# HUBRIS — Design Document

*A roguelite about growing beyond the gods' patience.*

**Elevator pitch:** Hades' chamber-crawl structure and god-boon buildcraft, fused with
Megabonk's horde-survival auto-battler growth. You carve through chambers of the
underworld with an aimed strike and an i-frame dash while an arsenal of auto-firing
weapons snowballs around you — and by the end of a run your damage numbers should be
absurd, on purpose.

---

## 1. Research summary

### What Hades does (and what we take)

| Mechanic | How Hades does it | What HUBRIS takes |
|---|---|---|
| Run structure | Chambers; each door previews its reward, giving path agency | ✅ Chambers with 2–3 doors, each showing its reward icon |
| Boons | Gods offer 3 choices with rarities (Common/Rare/Epic…), slotted onto Attack/Dash/etc.; Duo boons need boons from two gods | ✅ 3 gods, rarity multipliers, duo boons as build-defining synergies |
| Combat | Active & skill-based: aimed attack, dash with i-frames | ✅ Mouse-aimed strike + dash with invulnerability frames |
| Meta progression | Mirror of Night: spend Darkness on permanent upgrades (Death Defiance, extra dash…) | ✅ "Mirror of Hubris": spend Ichor on permanent upgrades |
| Death | Death is progress; you keep meta currency | ✅ Same loop |

### What Megabonk does (and what we take)

| Mechanic | How Megabonk does it | What HUBRIS takes |
|---|---|---|
| Hordes | Massive continuous enemy waves; character auto-attacks | ✅ Continuous spawns per chamber with a kill quota; auto-weapons do the horde-clearing |
| Growth | XP orbs → level up → pick weapons / tomes (passive stat items) | ✅ XP gems → 1-of-3 card picks: auto-weapons + tomes |
| Stacking math | **Damage brackets**: bonuses add *within* a bracket, brackets *multiply* each other → exponential feel that stays balanceable | ✅ Implemented literally (see §4) |
| Snowballing | "Holy Trinity": XP + Luck tomes compound run quality | ✅ Insight (XP) and Fortune (luck→rarity odds) tomes |
| Evolutions | Weapons at max level evolve into stronger forms | ✅ Weapons "Transcend" at max level |
| Feel | Screen-filling enemies, huge damage numbers | ✅ Damage numbers, crits, glow, screenshake |

---

## 2. Core fantasy & loop

**Fantasy:** start a chamber barely holding the horde back; end the run as a walking
storm that deletes screens of enemies — then get slapped down by the boss, buy mirror
upgrades, and go again stronger.

**Loop (one run, ~15–20 min):**
1. Enter chamber → horde spawns continuously → fill the kill quota.
2. Enemies drop XP gems & gold → level-ups mid-combat → pick weapon/tome cards.
3. Quota met → survivors dissolve → 2–3 doors appear with reward previews.
4. Pick a door: God Boon / Gold / Ambrosia heal / XP cache / Ichor / Chest.
5. Chamber 10: **boss**. Win or die → Ichor banked → Mirror of Hubris → next run.

## 3. Combat

- **Move:** WASD. **Strike:** mouse-aimed crescent slash, hold to repeat (~0.35s), knockback.
- **Dash:** Space/Shift toward movement dir, i-frames, 2 charges (rechargeable, meta/boons add more).
- **Auto-weapons:** up to 5 equipped, fire on their own. The player's job is positioning,
  dashing, and strike-focusing elites while the arsenal grinds the horde.
- **Damage taken:** enemy contact/projectiles; 0.6s mercy invulnerability after a hit.

### Auto-weapon roster (MVP: 5, each 7 levels, level 7 = Transcended)
1. **Aegis Shards** — orbiting blades (levels: +blades, +damage, +radius/speed)
2. **Seeker Darts** — homing darts at nearest enemies (+count, +rate, +damage)
3. **Pulse of Olympus** — periodic radial nova (+radius, +damage, −cooldown)
4. **Cinder Path** — burning trail while moving (+width, +DPS, +duration)
5. **Returning Chakram** — piercing boomerang through the horde (+count, +damage, +size)

### Tomes (passives, 5 levels each)
Might (+dmg), Haste (+attack speed), Vitality (+max HP & heal), Insight (+XP),
Fortune (+luck → rarity/choice odds), Greed (+gold), Winged Sandals (+move speed),
Precision (+crit chance).

## 4. Growth math — damage brackets (the Megabonk engine)

`damage = base × (1 + Might bracket) × (1 + source bracket) × (1 + vulnerability bracket) × crit`

- **Might bracket:** Tome of Might + mirror Ferocity + generic boons (additive within).
- **Source bracket:** strike-specific or auto-weapon-specific bonuses (Ares strike %, etc.).
- **Vulnerability bracket:** debuffs on the enemy (Jolted, Wounded).
- **Crit:** chance × multiplier (Precision tome, Ares boons).

Additive within, multiplicative across → diversified builds outscale one-stat stacking,
and late-run numbers get gloriously large without breaking balance.

## 5. Boons — 3 gods, rarities, duos

Rarity roll: Common ×1.0 (white) / Rare ×1.5 (blue) / Epic ×2.25 (purple); luck shifts odds.

- **ZEUS — storm:** chain lightning on strike; dash leaves a static bolt; auto-weapons
  can smite; hits apply **Jolted** (vulnerability). Legendary-ish capstone via duos.
- **ARES — carnage:** +strike damage; kills detonate blood novas; +crit; hits apply
  **Wounded** (DoT); kill-streak damage frenzy.
- **HERMES — tempo:** +move/attack speed, +dash charge, faster recharge, +pickup radius.

**Duo boons** (require a boon from each god):
- *Vengeful Sky* (Zeus+Ares): blood novas call lightning strikes.
- *Ride the Lightning* (Zeus+Hermes): dash becomes a damaging lightning blink.
- *Battle Trance* (Ares+Hermes): kill-streak frenzy also grants speed.

## 6. Chambers & enemies

- Arena ~1700×1250 with pillar obstacles; camera follows with shake.
- Continuous edge-spawning waves; **kill quota** scales per chamber; progress bar on HUD.
- Chambers 1–9 escalate HP/damage/density; every ~3rd chamber spawns **elites**
  (glowing, tougher, drop Ichor). Chamber 10: **The Gatekeeper** — 2-phase boss
  (radial bursts, telegraphed charge, add summons; enrage spiral at 50%).

**Enemy roster:** Shade (chaser swarm), Skitter (fast pack), Spitter (ranged),
Brute (tanky slugger), Cinder (kamikaze exploder), Weaver (fan-firing), Reaver (fast lunger), Stalker (interceptor that leads your movement) + Elite affixes + bosses.

## 7. Meta progression — Mirror of Hubris

Currency: **Ichor** (elites, boss, victory). Permanent upgrades, escalating costs:
Vigor (+HP), Ferocity (+dmg), Swiftness (+speed), Death Defiance (1 revive),
Second Wind (+1 dash charge), Keen Eye (+reroll per run), Golden Touch (+gold),
Scholar (+XP), Fortune's Favor (+luck), Head Start (start with a Common boon).
Saved to localStorage, plus lifetime stats (runs, kills, best chamber).

## 8. Presentation

- **Tech:** TypeScript + Vite, Canvas 2D world rendering, DOM/CSS overlays for menus.
  Zero external assets — everything procedural.
- **Style:** dark navy/indigo underworld, subtle floor grid & vignette; entities as
  glowing geometric forms with eyes (character without sprites); gold/white player vs
  red/purple horde; additive-blend glow sprites (pre-rendered, no per-frame shadowBlur).
- **Juice:** floating damage numbers (gold pop on crit), hit-flash, hit-stop on big hits,
  screenshake, death bursts, XP gem vacuum, level-up shockwave.
- **Audio:** WebAudio-synthesized SFX (hits, dash, pickups, level-up, boss) + a small
  generative music loop; mute toggle.
- **Perf:** spatial hash collisions, swap-remove arrays, pooled particles, entity caps.

## 9. MVP cut (this build)

**IN:** full run loop (10 chambers + boss), 5 auto-weapons w/ Transcend, 8 tomes,
3 gods × 5 boons + 3 duos + rarities, bracket damage, 5 enemy types + elites + boss,
door rewards (6 types), Mirror of Hubris (10 upgrades), death/victory flow, HUD +
build panel, damage numbers/shake/particles, synth SFX + music, localStorage save.

**OUT (post-MVP):** more gods & legendaries, weapon aspects, Chaos-style gamble
rooms, keepsakes, NPC story beats.

## 9b. v0.2 — shipped after the MVP

- **Combat feel:** 3-hit strike combo (finisher: ×1.7 damage, bigger knockback,
  longer recovery), forward lunge per swing, hit-stop on melee kills, brute
  windup + telegraphed lunge, pre-fire warning flash on spitters/weavers.
- **Run variety:** Charon's Wares shop door (gold sink: heal / weapon level /
  random boon / +luck), Pom of Power door (raise a boon's rarity), second boss
  (**The Shepherd of Shades** — summoner: homing soul volleys, teleports,
  closing rings with an escape gap), Ember Court biome from chamber 6 (palette,
  music, and the fan-firing **weaver**), elite affixes (splitter / warded /
  burning), boss HP scaled to a build-power estimate.
- **Retention:** 3 unlockable weapons via lifetime quests (Storm Lash / Mirror
  Blades / Comet Shard) with an Arsenal progress screen, Pact of Punishment
  heat modifiers (+2 ichor per heat on wins), and **endless mode** after the
  chamber-10 boss with a boss every 5 chambers and incremental ichor banking.
- **Presentation:** animated player figure with a visible swinging sword and a
  death animation, discrete flame-tongue rendering for fire patches, music
  moods (calm / combat / boss + per-biome progressions, ducked under overlays),
  settings screen (volumes, screen shake, damage-number density), gamepad
  support for gameplay.
- **Engineering:** run-end banking made incremental and idempotent (the boss
  victory timer is sim-time, not wall-clock), and a headless test harness
  (`npm test`) that drives the real simulation in Node with a greedy bot —
  covering bracket math, banking, unlocks, the shop, poms, boss scaling, heat,
  and a full-run smoke test.
- **Obelisks (v0.3):** capturable shrines echoing Megabonk's charge shrines —
  1-2 spawn per combat chamber (from chamber 2, never in boss arenas). Stand in
  the dashed ring to channel for 3.5s; leaving decays progress and the first
  moment of channeling spawns a defense wave. Six kinds: Wrath (+35% damage
  bracket, 45s), Storms (auto-bolts, 30s), Haste (+30% attack / +20% move
  speed, 30s), Greed (gold shower + +50% gold, 60s), Vigor (25% heal + regen),
  Souls (XP burst + full-map gem vacuum). Timed buffs are a fifth multiplicative
  damage bracket, shown as HUD chips with countdowns; off-screen obelisks get
  edge arrows. Save codes via Settings → SAVE DATA (export/import/wipe).
- **v0.3 follow-ups:** strike lunge removed (movement during attacks felt
  clunky); world **chests** (free = 1 upgrade; gilded = gold cost, 2 upgrades);
  a **major boss every 5 chambers** (chamber-5 heralds at 0.55× HP; only the
  chamber-10 Gatekeeper counts as the escape/win); chambers lengthened —
  arena grown to 2000×1450 and kill quotas raised ~25% (16 + 9·c).
- **The Long Descent (v0.7):** the run doubles to **20 chambers**. Boss
  cadence: herald (ch5, 0.55x HP) → **Twin Gates barrier** (ch10 — both bosses
  at once, 0.6x each) → lone gate (ch15, 0.85x) → **Final Gates** (ch20 —
  both bosses again at 0.9x each; the only fight that counts as the escape).
  Twin fights show stacked HP bars; the chamber falls only when both die
  (first kill pays +5 ichor). Every conquered boss chamber bestows a
  guaranteed **LEGENDARY boon** (orange tier, no reroll, never in normal
  offerings, one per god): Skyfather's Wrath (permanent storm), Rage
  Incarnate (frenzy never decays, +25% cap), Divine Celerity (+dash charge,
  +20% attack speed, faster recharge), King Tide (finishing blows release
  breaking waves). All four owned -> +20 ichor fallback.
- **Poseidon + arsenal II (v0.6):** a 4th god joins the pantheon — Poseidon's
  5 tide boons (Tidal Strike knockback, Crushing Depths wall-slams, Breaking
  Wave dash surge, Undertow **Chill** status −28% speed, Ocean's Bounty double
  loot) and 3 new duos (Sea Storm: chilled foes +15% vulnerable; Blood Tide:
  shoving novas; Slipstream: dash shoulders enemies aside). Three new
  auto-weapons: Phalanx Spears (deep-piercing volley), Tartarus Snare
  (chilling proximity mines), Echo Hammer (directional AoE slam, unlocked by
  completing 10 runs) — 11 weapons total. Four new tomes (Colossus vs
  elites/bosses, Turtle armor, Momentum hybrid speed, Leech kill-heal) — 12
  total. New **Forge door**: a guaranteed weapon level (Daedalus-style).
- **Mirror II + skins (v0.5):** the Mirror grows to 18 modifiers — extended
  ranks (Vigor/Ferocity ×7, Death Defiance ×2, Head Start ×2…) plus 8 new
  hooks: Thick Skin (flat armor, min 1), Lethality (crit), Deep Pockets
  (starting gold), Awakening (start leveled), Council of Gods (4th boon
  offering), Lingering Echoes (+20% buff duration), Charon's Favor (−10%
  prices), Lodestone (pickup radius). Total sink ≈ 800 ichor. Each character
  gets 2 unlockable **skins** (body/trim recolors of sprite + weapons) gated
  by per-character feats tracked in new per-character save stats; selection
  lives on the character-select swatches, unlock toasts ride the end screen.
- **Characters (v0.4):** run-start selection between three shades, each with
  its own basic attack in the strike bracket (so Ares/strike boons serve all
  three): the Exile (melee combo + projectile parry, +20 HP), the Huntress
  (piercing arrows, 3rd-shot triple volley, +50% pickup radius +5% move
  speed), the Oracle (exploding orbs, 3rd-cast surge, mana shield = 25% max
  HP absorbing before health, regenerating 9/s after 6s out of danger).
  On-hit boon procs (Wounds, Chain Lightning) fire from arrows and orbs too.
  Last-played character is remembered in the save.
- **Altars of Fate:** chaos-gamble towers (hovering magenta shard, distinct
  from buff obelisks), ~35% chance per chamber from chamber 3. Capturing one
  rolls a random **run-long modifier** from 14 fates: 6 blessings (+damage,
  +attack speed, +move speed, +HP, +gold, +luck), 4 banes (enemy HP/speed up,
  −HP, −XP), 4 mixed pacts (Glass Cannon, Berserker's Pact, Midas Curse,
  Blood Price — the last adds a damage-taken multiplier). Enemy-side fates
  stack multiplicatively with heat and also scale bosses; accepted fates show
  in the build panel under FATES.

## 10. Sources consulted

- [Boons — Hades Wiki](https://hades.fandom.com/wiki/Boons)
- [Chamber Reward — Hades Wiki](https://hades.fandom.com/wiki/Chamber_Reward)
- [Mirror of Night — Hades Wiki](https://hades.fandom.com/wiki/Mirror_of_Night)
- [Megabonk Damage Brackets Explained](https://megabonk.org/guides/mechanics/damage-brackets/)
- [Megabonk Linear Scaling Explained](https://megabonk.org/guides/mechanics/scaling-types/)
- [MegaBonk Do Items Stack — Full Guide](https://gamerblurb.com/articles/megabonk-do-items-stack-full-guide)
- [Megabonk Progression Guide](https://megabonk.org/guides/progression/)
- [Megabonk Beginners Guide](https://megabonk.org/guides/megabonk-beginners-guide)
