// ---------------------------------------------------------------------------
// Headless balance & correctness regression tests.
// These run the real simulation in Node — no DOM, no rendering.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
import { createHeadlessGame, grantStrongBuild, runBot, stepFrames } from '../src/testkit';
import { MASSACRE_WINDOW as MASSACRE_WINDOW_S, WEAPON_DEFS, isBossChamber, weaponUnlocked } from '../src/game/data';
import { defaultSave } from '../src/game/meta';

describe('bracket damage math', () => {
  it('multiplies across brackets, adds within', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.stats.might = 1;        // bracket A: +100%
    g.stats.strikePct = 1;    // bracket B: +100%
    // (1 + 1) * (1 + 1) = 4, not 1 + 1 + 1 = 3
    expect(g.damageMult('strike', false)).toBeCloseTo(4);
    // auto uses its own source bracket
    expect(g.damageMult('auto', false)).toBeCloseTo(2);
    // vulnerability is a further multiplier
    g.mods.joltPct = 0.5;
    expect(g.damageMult('strike', true)).toBeCloseTo(6);
  });
});

describe('meta banking', () => {
  it('is idempotent per run — double endRun cannot double-count', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.totals.kills = 10;
    g.endRun(false);
    g.endRun(false);
    g.endRun(true); // even switching outcomes cannot re-bank
    expect(g.save.runs).toBe(1);
    expect(g.save.wins).toBe(0);
    expect(g.save.kills).toBe(10);
  });

  it('banks incrementally across an endless run without double-counting', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.totals.kills = 50;
    g.addIchor(5);
    // Simulate the chamber-10 victory bank
    (g as unknown as { bankMeta(win: boolean): void }).bankMeta(true);
    expect(g.save.wins).toBe(1);
    expect(g.save.kills).toBe(50);
    const ichorAfterWin = g.save.ichor;
    // More progress in endless, then death-bank
    g.totals.kills = 80;
    g.addIchor(3);
    g.endRun(false);
    expect(g.save.wins).toBe(1);          // win not re-counted
    expect(g.save.kills).toBe(80);        // only the delta added
    expect(g.save.ichor).toBe(ichorAfterWin + 3);
  });
});

describe('weapon unlocks', () => {
  it('gates locked weapons out of the level-up pool', () => {
    const { g } = createHeadlessGame();
    g.save = defaultSave();
    g.startRun();
    const lockedIds = new Set(['lash', 'mirror', 'comet']);
    for (let i = 0; i < 60; i++) {
      for (const c of g.genLevelChoices(3)) {
        if (c.kind === 'weapon') expect(lockedIds.has(c.id)).toBe(false);
      }
    }
  });

  it('unlocks by lifetime counters', () => {
    const save = defaultSave();
    const mirror = WEAPON_DEFS.find((w) => w.id === 'mirror')!;
    const comet = WEAPON_DEFS.find((w) => w.id === 'comet')!;
    expect(weaponUnlocked(mirror, save)).toBe(false);
    save.wins = 1;
    expect(weaponUnlocked(mirror, save)).toBe(true);
    expect(weaponUnlocked(comet, save)).toBe(false);
    save.kills = 2000;
    expect(weaponUnlocked(comet, save)).toBe(true);
  });
});

describe("Charon's shop", () => {
  it('charges gold and applies effects', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.gold = 1000;
    g.player.hp = 10;
    g.shopItems = g.genShopItems();
    const ambrosia = g.shopItems.find((i) => i.id === 'ambrosia')!;
    expect(g.buyShopItem(ambrosia)).toBe(true);
    expect(g.player.hp).toBeGreaterThan(10);
    expect(g.gold).toBe(1000 - ambrosia.cost);
    expect(g.buyShopItem(ambrosia)).toBe(false); // no double-buys
    const luckBefore = g.stats.luck;
    const contract = g.shopItems.find((i) => i.id === 'contract')!;
    expect(g.buyShopItem(contract)).toBe(true);
    expect(g.stats.luck).toBe(luckBefore + 2);
    g.recomputeStats();
    expect(g.stats.luck).toBe(luckBefore + 2); // survives recompute
  });

  it('refuses purchases the player cannot afford', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.gold = 0;
    g.shopItems = g.genShopItems();
    expect(g.buyShopItem(g.shopItems[0])).toBe(false);
  });
});

describe('pom of power', () => {
  it('upgrades a boon rarity one step', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.boons = [{ id: 'a_strike', rarity: 'common' }];
    g.recomputeStats();
    const choices = g.genPomChoices();
    expect(choices.length).toBe(1);
    expect(choices[0].to).toBe('rare');
    g.applyPom(choices[0]);
    expect(g.boons[0].rarity).toBe('rare');
  });

  it('offers nothing when everything is epic or duo', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.boons = [
      { id: 'a_strike', rarity: 'epic' },
      { id: 'd_vengefulsky', rarity: 'epic' },
    ];
    expect(g.genPomChoices().length).toBe(0);
  });
});

describe('boss fights', () => {
  it('a strong build out-damages the chamber-15 gate', () => {
    // Deterministic: pin the player point-blank (the greedy bot kites too
    // badly vs the teleporting Shepherd to be a reliable yardstick).
    const { g, input } = createHeadlessGame();
    g.startRun();
    grantStrongBuild(g);
    g.setupChamber(15);
    expect(g.enemies.some((e) => e.bossState)).toBe(true);
    input.mouseDown = true;
    for (let i = 0; i < 180 && g.enemies.some((e) => e.bossState); i++) {
      const b = g.enemies.find((e) => e.bossState)!;
      g.player.x = b.x + 120;
      g.player.y = b.y;
      g.player.hp = g.stats.maxHP; // tank the retaliation; DPS is on trial here
      input.mouseX = g.cam.toScreenX(b.x);
      input.mouseY = g.cam.toScreenY(b.y);
      stepFrames(g, input, 30);
    }
    expect(g.enemies.some((e) => e.bossState)).toBe(false);
  });

  it('boss HP scales with build power', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(10);
    const weakHP = g.enemies.find((e) => e.bossState)!.maxHP;
    const { g: g2 } = createHeadlessGame();
    g2.startRun();
    grantStrongBuild(g2);
    g2.setupChamber(10);
    const strongHP = g2.enemies.find((e) => e.bossState)!.maxHP;
    expect(strongHP).toBeGreaterThan(weakHP);
  });

  it('endless mode schedules a boss every 5 chambers past 10', () => {
    expect(isBossChamber(10)).toBe(true);
    expect(isBossChamber(11)).toBe(false);
    expect(isBossChamber(15)).toBe(true);
    expect(isBossChamber(20)).toBe(true);
    expect(isBossChamber(23)).toBe(false);
  });
});

describe('full-run smoke test', () => {
  it('a greedy bot survives chamber 1 and reaches chamber 2+', () => {
    let best = 0;
    for (let attempt = 0; attempt < 3 && best < 2; attempt++) {
      const { g, input } = createHeadlessGame();
      g.startRun();
      runBot(g, input, 120);
      best = Math.max(best, g.chamber);
    }
    expect(best).toBeGreaterThanOrEqual(2);
  });

  it('heat modifiers raise quotas and enemy stats', () => {
    const { g } = createHeadlessGame();
    g.save.heat = { quota: 1, foes: 2 };
    g.startRun();
    const heatedQuota = g.quota;
    const heatedEnemy = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade');
    const { g: g2 } = createHeadlessGame();
    g2.save.heat = {};
    g2.startRun();
    expect(heatedQuota).toBeGreaterThan(g2.quota);
    const plainEnemy = g2.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade');
    expect(heatedEnemy.maxHP).toBeGreaterThan(plainEnemy.maxHP);
  });
});

describe('save persistence', () => {
  it('export/import round-trips the full save', async () => {
    const { exportSave, importSave } = await import('../src/game/meta');
    const s = defaultSave();
    s.ichor = 42;
    s.mirror.vigor = 3;
    s.wins = 2;
    s.heat.foes = 1;
    s.seenUnlocks.push('lash');
    const back = importSave(exportSave(s))!;
    expect(back).not.toBeNull();
    expect(back.ichor).toBe(42);
    expect(back.mirror.vigor).toBe(3);
    expect(back.wins).toBe(2);
    expect(back.heat.foes).toBe(1);
    expect(back.seenUnlocks).toContain('lash');
  });

  it('rejects garbage save codes', async () => {
    const { importSave } = await import('../src/game/meta');
    expect(importSave('definitely not base64!!!')).toBeNull();
    expect(importSave(btoa('{"foo":1}'))).toBeNull();
    expect(importSave(btoa('[1,2,3]'))).toBeNull();
  });

  it('wipeSave restores factory defaults', () => {
    const { g } = createHeadlessGame();
    g.save.ichor = 99;
    g.save.mirror.vigor = 5;
    g.save.wins = 3;
    g.wipeSave();
    expect(g.save.ichor).toBe(0);
    expect(g.save.mirror.vigor ?? 0).toBe(0);
    expect(g.save.wins).toBe(0);
  });
});

describe('obelisk towers', () => {
  it('spawn in combat chambers but never in boss arenas', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    expect(g.towers.length).toBeGreaterThanOrEqual(1);
    g.setupChamber(10);
    expect(g.towers.length).toBe(0);
  });

  it('channeling captures the tower and grants its buff', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    const t = g.towers[0];
    t.kind = 'wrath';
    const base = g.damageMult('strike', false);
    // Stand on the obelisk until the channel completes (knockback is re-pinned)
    for (let i = 0; i < 12 && !t.captured; i++) {
      g.player.x = t.x;
      g.player.y = t.y;
      g.player.hp = g.stats.maxHP;
      stepFrames(g, input, 30);
    }
    expect(t.captured).toBe(true);
    expect(t.waveSpawned).toBe(true); // the defense wave contested it
    expect(g.buffBonus('wrath')).toBeCloseTo(0.35);
    expect(g.damageMult('strike', false)).toBeGreaterThan(base);
    // Buff expires after its duration
    stepFrames(g, input, 46 * 60);
    expect(g.buffBonus('wrath')).toBe(0);
  });

  it('progress decays when the player leaves the ring', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    const t = g.towers[0];
    g.player.x = t.x;
    g.player.y = t.y;
    stepFrames(g, input, 60); // ~1s of channel
    const partial = t.progress;
    expect(partial).toBeGreaterThan(0.15);
    g.player.x = t.x + 500; // walk away
    g.player.y = t.y + 300;
    stepFrames(g, input, 60);
    expect(t.progress).toBeLessThan(partial);
  });
});

describe('chests & five-chamber bosses', () => {
  it('a herald boss guards chamber 5 and does not count as a win', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(5);
    const boss = g.enemies.find((e) => e.bossState);
    expect(boss).toBeDefined();
    const ichorBefore = g.save.ichor + g.ichorRun;
    g.dealDamage(boss!, 1e9, { source: 'strike' });
    expect(g.save.wins).toBe(0);          // only chamber 10 counts an escape
    expect(g.save.ichor).toBeGreaterThan(ichorBefore); // herald pays ichor
    // Loot (gems + the boss's gold) is vacuumed during a short breather...
    expect(g.pickups.length).toBeGreaterThan(0);
    expect(g.pickups.some((p) => p.kind === 'gold')).toBe(true);
    expect(g.pickups.every((p) => p.magnet)).toBe(true);
    expect(g.phase).toBe('combat');       // doors wait for the breather
    expect(g.doors.length).toBe(0);
    // ...then the doors appear on their own
    stepFrames(g, input, 220); // hit-stop + ~2.2s delay
    expect(g.phase).toBe('cleared');
    expect(g.doors.length).toBeGreaterThan(0);
    expect(g.pickups.length).toBe(0);     // everything was collected
    expect(isBossChamber(5)).toBe(true);
  });

  it('herald bosses are lighter than the chamber-10 fight', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(5);
    const heraldHP = g.enemies.find((e) => e.bossState)!.maxHP;
    g.setupChamber(10);
    const finalHP = g.enemies.find((e) => e.bossState)!.maxHP;
    expect(heraldHP).toBeLessThan(finalHP);
  });

  it('free chests open on touch and grant an upgrade', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(2);
    g.chests = [{ x: g.player.x, y: g.player.y, gilded: false, cost: 0, phase: 0, nagged: false }];
    const powerBefore = g.buildPower();
    const goldBefore = g.gold;
    stepFrames(g, input, 2);
    expect(g.chests.length).toBe(0);
    expect(g.buildPower() > powerBefore || g.gold > goldBefore).toBe(true);
  });

  it('gilded chests charge gold and refuse the poor', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    g.chests = [{ x: g.player.x, y: g.player.y, gilded: true, cost: 100, phase: 0, nagged: false }];
    g.gold = 20;
    stepFrames(g, input, 2);
    expect(g.chests.length).toBe(1); // too poor — still closed
    g.gold = 150;
    g.chests[0].nagged = false;
    stepFrames(g, input, 2);
    expect(g.chests.length).toBe(0);
    expect(g.gold).toBe(50);
  });

  it('strike no longer moves the player', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.enemies = []; // nothing to knock us around
    const x0 = g.player.x;
    const y0 = g.player.y;
    input.mouseDown = true;
    stepFrames(g, input, 30); // several swings
    expect(g.player.x).toBe(x0);
    expect(g.player.y).toBe(y0);
  });
});

describe('altars of fate', () => {
  it('spawn as chaos towers on their own schedule', async () => {
    const { g } = createHeadlessGame();
    g.startRun();
    let sawChaos = false;
    for (let i = 0; i < 40 && !sawChaos; i++) {
      g.setupChamber(4);
      sawChaos = g.towers.some((t) => t.kind === 'chaos');
    }
    expect(sawChaos).toBe(true);
  });

  it('capturing an altar applies a run-long modifier', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(4);
    g.towers = [{ x: 0, y: 0, kind: 'chaos', progress: 0, captured: false, waveSpawned: false, phase: 0 }];
    for (let i = 0; i < 12 && !g.towers[0].captured; i++) {
      g.player.x = 0;
      g.player.y = 0;
      g.player.hp = g.stats.maxHP;
      stepFrames(g, input, 30);
    }
    expect(g.towers[0].captured).toBe(true);
    expect(g.fates.length).toBe(1);
  });

  it('fate modifiers affect player stats, enemies, and damage taken', async () => {
    const { CHAOS_MODS } = await import('../src/game/data');
    const { g } = createHeadlessGame();
    g.startRun();
    const might0 = g.stats.might;
    g.applyFate(CHAOS_MODS.find((m) => m.id === 'fate_glass')!);
    expect(g.stats.might).toBeCloseTo(might0 + 0.25);
    expect(g.fates[0].polarity).toBe('mixed');
    // enemy-side: Hungry Depths raises spawned enemy HP
    const plain = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade').maxHP;
    g.applyFate(CHAOS_MODS.find((m) => m.id === 'fate_hungry')!);
    const beefed = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade').maxHP;
    expect(beefed).toBeGreaterThan(plain);
    // damage taken: Blood Price makes hits hurt more
    g.applyFate(CHAOS_MODS.find((m) => m.id === 'fate_blood')!);
    g.player.hp = 100;
    g.player.invulnT = 0;
    g.hurtPlayer(20);
    expect(g.player.hp).toBeCloseTo(100 - 20 * 1.15);
  });
});

describe('characters', () => {
  it('passives differentiate the three shades', () => {
    const { g: warrior } = createHeadlessGame();
    warrior.startRun('warrior');
    const { g: archer } = createHeadlessGame();
    archer.startRun('archer');
    const { g: mage } = createHeadlessGame();
    mage.startRun('mage');
    expect(warrior.stats.maxHP).toBe(120);            // battle-hardened
    expect(archer.stats.pickupRadius).toBeGreaterThan(warrior.stats.pickupRadius);
    expect(mage.maxShield()).toBe(25);                // 25% of 100
    expect(warrior.maxShield()).toBe(0);
    expect(mage.player.shield).toBe(25);
  });

  it('the archer fires long-range arrows instead of melee swings', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('archer');
    g.phase = 'cleared'; // stop the spawner so arrows fly unobstructed
    g.enemies = [];
    input.mouseDown = true;
    input.mouseX = g.cam.toScreenX(g.player.x + 100);
    input.mouseY = g.cam.toScreenY(g.player.y);
    stepFrames(g, input, 5);
    const arrows = g.projectiles.filter((p) => p.kind === 'arrow');
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows[0].friendly).toBe(true);
    // travels far beyond melee range before expiring
    stepFrames(g, input, 30);
    const travelled = Math.max(...g.projectiles.filter((p) => p.kind === 'arrow')
      .map((p) => Math.hypot(p.x - g.player.x, p.y - g.player.y)), 0);
    expect(travelled).toBeGreaterThan(200);
  });

  it("the mage's mana shield absorbs damage and regenerates", () => {
    const { g, input } = createHeadlessGame();
    g.startRun('mage');
    g.phase = 'cleared'; // no spawns — nothing may interrupt the regen
    g.enemies = [];
    const hp0 = g.player.hp;
    g.player.invulnT = 0;
    g.hurtPlayer(10);
    expect(g.player.hp).toBe(hp0);         // fully absorbed
    expect(g.player.shield).toBe(15);
    // a big hit chews through the shield into HP
    g.player.invulnT = 0;
    g.hurtPlayer(40);
    expect(g.player.shield).toBe(0);
    expect(g.player.hp).toBeCloseTo(hp0 - 25);
    // regenerates after the delay
    stepFrames(g, input, Math.round(6.5 * 60) + 60);
    expect(g.player.shield).toBeGreaterThan(5);
  });

  it('mage orbs explode with an area blast', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('mage');
    g.phase = 'cleared'; // no extra spawns — only our cluster
    g.enemies = [];
    // a tight cluster to the right (track refs; dead ones leave g.enemies)
    const cluster: import('../src/game/types').Enemy[] = [];
    for (let i = 0; i < 3; i++) {
      const e = g.spawnEnemyAt({ x: g.player.x + 150, y: g.player.y + (i - 1) * 20 }, false, 'shade');
      e.spawnT = 0;
      cluster.push(e);
    }
    input.mouseDown = true;
    input.mouseX = g.cam.toScreenX(g.player.x + 150);
    input.mouseY = g.cam.toScreenY(g.player.y);
    stepFrames(g, input, 40);
    const hurt = cluster.filter((e) => e.hp < e.maxHP).length;
    expect(hurt).toBeGreaterThanOrEqual(2); // blast catches neighbors
  });
});

describe('accessibility assists', () => {
  it('auto-aim locks the aim onto the nearest enemy', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('warrior');
    g.save.settings.autoAim = true;
    g.phase = 'cleared';
    g.enemies = [];
    const e = g.spawnEnemyAt({ x: g.player.x, y: g.player.y - 200 }, false, 'shade');
    e.spawnT = 0;
    // mouse points right; auto-aim should override and point up instead
    input.mouseX = g.cam.toScreenX(g.player.x + 300);
    input.mouseY = g.cam.toScreenY(g.player.y);
    stepFrames(g, input, 2);
    expect(Math.abs(g.player.aim - (-Math.PI / 2))).toBeLessThan(0.3);
  });

  it('auto-fire attacks on its own when a target is in range', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('archer');
    g.save.settings.autoAim = true;
    g.save.settings.autoFire = true;
    g.phase = 'cleared';
    g.enemies = [];
    const e = g.spawnEnemyAt({ x: g.player.x + 200, y: g.player.y }, false, 'shade');
    e.spawnT = 0;
    input.mouseDown = false;
    stepFrames(g, input, 60);
    expect(e.hp).toBeLessThan(e.maxHP); // arrows found it unaided
  });

  it('auto-fire holds back when nothing is in reach', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('warrior'); // melee reach ~114px
    g.save.settings.autoFire = true;
    g.phase = 'cleared';
    g.enemies = [];
    const e = g.spawnEnemyAt({ x: g.player.x + 500, y: g.player.y }, false, 'shade');
    e.spawnT = 0;
    stepFrames(g, input, 10);
    expect(g.player.comboIdx).toBe(0); // no wild swinging at air
  });
});

describe('expanded mirror of hubris', () => {
  it('thick skin reduces damage taken but never below 1', () => {
    const { g } = createHeadlessGame();
    g.save.mirror = { armor: 3 };
    g.startRun();
    g.player.hp = 100;
    g.player.invulnT = 0;
    g.hurtPlayer(10);
    expect(g.player.hp).toBeCloseTo(93);   // 10 - 3 armor
    g.player.invulnT = 0;
    g.hurtPlayer(2);
    expect(g.player.hp).toBeCloseTo(92);   // floored at 1
  });

  it('awakening and deep pockets shape the run start', () => {
    const { g } = createHeadlessGame();
    g.save.mirror = { awakening: 2, pockets: 3 };
    g.startRun();
    expect(g.level).toBe(3);               // 1 + 2 ranks
    expect(g.gold).toBe(150);              // 50 * 3 ranks
    // the headless stub auto-picks, so pending level-ups resolved instantly
    expect(g.weapons.length + Object.keys(g.tomes).length).toBeGreaterThanOrEqual(2);
  });

  it('council of gods adds a 4th boon offering', () => {
    const { g } = createHeadlessGame();
    g.save.mirror = { council: 1 };
    g.startRun();
    expect(g.genBoonChoices('zeus').length).toBe(4);
    g.save.mirror = {};
    expect(g.genBoonChoices('zeus').length).toBe(3);
  });

  it('lingering echoes stretch obelisk buffs', () => {
    const { g } = createHeadlessGame();
    g.save.mirror = { echoes: 3 };
    g.startRun();
    g.addBuff('wrath', 0.35, 45);
    expect(g.buffs[0].t).toBeCloseTo(45 * 1.6);
  });

  it('death defiance rank 2 revives twice', () => {
    const { g } = createHeadlessGame();
    g.save.mirror = { defiance: 2 };
    g.startRun();
    for (let i = 0; i < 2; i++) {
      g.player.hp = 1;
      g.player.invulnT = 0;
      g.hurtPlayer(999);
      expect(g.player.hp).toBeGreaterThan(0); // revived
    }
    g.player.hp = 1;
    g.player.invulnT = 0;
    g.player.shield = 0;
    g.hurtPlayer(999);
    expect(g.deathT).toBeGreaterThan(0);      // third death sticks
  });

  it("charon's favor discounts shop and reroll prices", () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.freeRerolls = 0;
    const full = g.genShopItems()[0].cost;
    const fullReroll = g.rerollCost()!;
    g.save.mirror = { charon: 3 };
    const cheap = g.genShopItems()[0].cost;
    expect(cheap).toBeLessThan(full);
    expect(g.rerollCost()!).toBeLessThanOrEqual(fullReroll);
  });
});

describe('character skins', () => {
  it('per-character stats bank separately and unlock skins', async () => {
    const { CHARACTERS, skinUnlocked } = await import('../src/game/data');
    const { charStatsFor } = await import('../src/game/meta');
    const { g } = createHeadlessGame();
    g.startRun('archer');
    g.totals.kills = 40;
    g.setupChamber(8);
    g.endRun(false);
    const cs = charStatsFor(g.save, 'archer');
    expect(cs.kills).toBe(40);
    expect(cs.bestChamber).toBe(8);
    expect(charStatsFor(g.save, 'warrior').kills).toBe(0);
    // Moonlit unlocks at chamber 8 as the Huntress
    const moonlit = CHARACTERS.find((c) => c.id === 'archer')!.skins[1];
    expect(skinUnlocked(moonlit, cs)).toBe(true);
    expect(g.save.seenSkins).toContain('a_moonlit');
    expect(g.lastUnlocks.some((u) => u.includes('Moonlit'))).toBe(true);
  });

  it('locked skins fall back to the default look', () => {
    const { g } = createHeadlessGame();
    g.character = 'warrior';
    g.save.skins['warrior'] = 'w_blood';        // selected but not earned
    expect(g.selectedSkin().id).toBe('w_default');
    charStatsForTest(g);
    expect(g.selectedSkin().id).toBe('w_blood'); // earned -> applies
    expect(g.playerColors().body).toBe('#ff5a5a');
  });
});

function charStatsForTest(g: ReturnType<typeof createHeadlessGame>['g']): void {
  g.save.charStats['warrior'] = { runs: 1, wins: 0, kills: 1000, bestChamber: 5 };
}

describe('poseidon & new content', () => {
  it('poseidon offers boons and joins the door pantheon', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    const offers = g.genBoonChoices('poseidon');
    expect(offers.length).toBe(3);
    expect(offers.every((o) => o.godLabel.includes('POSEIDON'))).toBe(true);
  });

  it('undertow chills foes hit by basic attacks and slows them', () => {
    const { g, input } = createHeadlessGame();
    g.startRun('archer');
    g.phase = 'cleared';
    g.enemies = [];
    g.boons = [{ id: 'p_slow', rarity: 'epic' }];
    g.recomputeStats();
    g.stats.critChance = 0; // a crit could one-shot a shade before chill lands
    // A brute survives many arrows, so chill definitely gets observed.
    const e = g.spawnEnemyAt({ x: g.player.x + 180, y: g.player.y }, false, 'brute');
    e.spawnT = 0;
    input.mouseDown = true;
    input.mouseX = g.cam.toScreenX(e.x);
    input.mouseY = g.cam.toScreenY(e.y);
    stepFrames(g, input, 40);
    expect(e.chillT).toBeGreaterThan(0);
  });

  it('phalanx spears, snares and the echo hammer all deal damage', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.phase = 'cleared';
    g.enemies = [];
    g.weapons = [
      { id: 'spear', level: 3, t: 0, angle: 0, trailT: 0 },
      { id: 'trap', level: 3, t: 0, angle: 0, trailT: 0 },
      { id: 'hammer', level: 3, t: 0, angle: 0, trailT: 0 },
    ];
    g.recomputeStats();
    const cluster = [];
    for (let i = 0; i < 4; i++) {
      const e = g.spawnEnemyAt({ x: g.player.x + 100 + i * 30, y: g.player.y }, false, 'shade');
      e.spawnT = 0;
      cluster.push(e);
    }
    input.mouseX = g.cam.toScreenX(g.player.x + 150);
    input.mouseY = g.cam.toScreenY(g.player.y);
    stepFrames(g, input, 150);
    expect(g.projectiles.some((p) => p.kind === 'spear') || cluster.some((e) => e.hp < e.maxHP)).toBe(true);
    expect(cluster.filter((e) => e.hp < e.maxHP).length).toBeGreaterThanOrEqual(2);
  });

  it('the forge door upgrades an owned weapon', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    const before = g.weapons[0].level;
    g.phase = 'cleared';
    g.enterDoor({ x: 0, y: 0, reward: 'forge' });
    expect(g.weapons[0].level).toBe(before + 1);
  });

  it('new tomes hook armor, leech and colossus damage', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    // Turtle: flat reduction on top of any mirror armor
    g.tomes = { turtle: 5 }; // +3 armor
    g.recomputeStats();
    g.player.hp = 100;
    g.player.invulnT = 0;
    g.hurtPlayer(10);
    expect(g.player.hp).toBeCloseTo(93);
    // Leech: kills heal
    g.tomes = { turtle: 5, leech: 5 }; // +1.5 HP per kill
    g.recomputeStats();
    const hpBefore = g.player.hp;
    const victim = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade');
    victim.spawnT = 0;
    g.dealDamage(victim, 1e9, { source: 'strike' });
    expect(g.player.hp).toBeGreaterThan(hpBefore);
    // Colossus: elites take extra
    g.tomes = { colossus: 5 }; // +40%
    g.recomputeStats();
    const grunt = g.spawnEnemyAt({ x: 0, y: 300 }, false, 'shade');
    const elite = g.spawnEnemyAt({ x: 0, y: -300 }, true, 'shade');
    grunt.spawnT = elite.spawnT = 0;
    g.stats.critChance = 0;
    const d1 = g.dealDamage(grunt, 100, { source: 'burn', canCrit: false });
    const d2 = g.dealDamage(elite, 100, { source: 'burn', canCrit: false });
    expect(d2).toBeCloseTo(d1 * 1.4);
  });
});

describe('twin bosses & legendaries (20-chamber run)', () => {
  it('chamber 10 is a twin barrier: both gates must fall, no win counted', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(10);
    const bosses = g.enemies.filter((e) => e.bossState);
    expect(bosses.length).toBe(2);
    // First gate falls — the fight continues
    g.dealDamage(bosses[0], 1e9, { source: 'strike' });
    expect(g.enemies.some((e) => e.bossState)).toBe(true);
    expect(g.doors.length).toBe(0);
    expect(g.save.wins).toBe(0);
    // Second gate falls — barrier cleared, run continues through doors
    g.dealDamage(g.enemies.find((e) => e.bossState)!, 1e9, { source: 'strike' });
    expect(g.save.wins).toBe(0);
    expect(g.pendingClearT).toBeGreaterThan(0);
    // ...and a Legendary was bestowed (headless stub auto-picks)
    expect(g.boons.some((b) => b.id.startsWith('l_'))).toBe(true);
    stepFrames(g, input, 220);
    expect(g.phase).toBe('cleared');
    expect(g.doors.length).toBeGreaterThan(0);
  });

  it('chamber 20 hosts the final twins and only they grant the win', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(20);
    const bosses = g.enemies.filter((e) => e.bossState);
    expect(bosses.length).toBe(2);
    g.dealDamage(bosses[0], 1e9, { source: 'strike' });
    expect(g.save.wins).toBe(0);
    g.dealDamage(g.enemies.find((e) => e.bossState)!, 1e9, { source: 'strike' });
    expect(g.save.wins).toBe(1);
    expect(g.pendingVictoryT).toBeGreaterThan(0);
  });

  it('legendaries never appear in normal god offerings and never repeat', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    for (let i = 0; i < 40; i++) {
      for (const god of ['zeus', 'ares', 'hermes', 'poseidon'] as const) {
        for (const c of g.genBoonChoices(god)) {
          expect(c.id.startsWith('l_')).toBe(false);
        }
      }
    }
    expect(g.genLegendaryChoices().length).toBe(3); // offers up to 3 of 4
    g.boons = [
      { id: 'l_zeus', rarity: 'epic' }, { id: 'l_ares', rarity: 'epic' },
      { id: 'l_hermes', rarity: 'epic' }, { id: 'l_poseidon', rarity: 'epic' },
    ];
    expect(g.genLegendaryChoices().length).toBe(0); // all owned -> ichor fallback
  });

  it('legendary effects hook the sim: storm lord bolts and undying frenzy', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.phase = 'cleared';
    g.weapons = [];  // isolate: only the storm may damage the target
    g.enemies = [];
    g.boons = [{ id: 'l_ares', rarity: 'epic' }]; // frenzy-no-decay; storm added below
    g.recomputeStats();
    g.stats.critChance = 0; // a crit could one-shot before a second bolt
    const e = g.spawnEnemyAt({ x: g.player.x + 200, y: g.player.y }, false, 'brute');
    e.spawnT = 0;
    e.speed = 0;
    stepFrames(g, input, 3);   // warm the spatial hash with the target present
    g.mods.stormLord = true;   // now the living storm awakens
    stepFrames(g, input, 30);  // its first bolt lands
    expect(e.hp).toBeLessThan(e.maxHP);
    // Rage Incarnate: stacks hold with no kills for many seconds
    g.enemies = []; // nothing left to kill (a kill would add a stack)
    g.frenzyStacks = 20;
    g.frenzyIdleT = 10;
    stepFrames(g, input, 120);
    expect(g.frenzyStacks).toBe(20);
  });
});

describe('clear-the-map progression', () => {
  it('the chamber clears only when the budget is spent AND nothing lives', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(2);
    g.enemies = [];
    g.spawnBudgetUsed = g.quota;    // spawner is done pouring
    // Two stragglers (e.g. splitter children) still block the doors
    const a = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade');
    const b = g.spawnEnemyAt({ x: 60, y: 0 }, false, 'shade');
    a.spawnT = b.spawnT = 0;
    g.dealDamage(a, 1e9, { source: 'strike' });
    expect(g.phase).toBe('combat');  // one still stands
    g.dealDamage(b, 1e9, { source: 'strike' });
    expect(g.phase).toBe('cleared'); // map empty -> doors
  });

  it('the spawner never exceeds the chamber budget', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.quota = 8;
    stepFrames(g, input, 600); // plenty of time to overspawn if it could
    expect(g.spawnBudgetUsed).toBeLessThanOrEqual(8);
  });

  it('unclaimed obelisks crumble on clear; captured ones remain', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    g.enemies = [];
    g.spawnBudgetUsed = g.quota;
    g.towers = [
      { x: 0, y: 0, kind: 'wrath', progress: 0.5, captured: false, waveSpawned: true, phase: 0 },
      { x: 300, y: 0, kind: 'haste', progress: 1, captured: true, waveSpawned: true, phase: 0 },
    ];
    const e = g.spawnEnemyAt({ x: -300, y: 0 }, false, 'shade');
    e.spawnT = 0;
    g.dealDamage(e, 1e9, { source: 'strike' });
    expect(g.phase).toBe('cleared');
    expect(g.towers.length).toBe(1);
    expect(g.towers[0].captured).toBe(true);
  });

  it('towers cannot be channeled after the chamber clears', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.setupChamber(3);
    g.phase = 'cleared';
    g.towers = [{ x: g.player.x, y: g.player.y, kind: 'wrath', progress: 0, captured: false, waveSpawned: false, phase: 0 }];
    stepFrames(g, input, 60); // standing right on it
    expect(g.towers[0].progress).toBe(0);
    expect(g.towers[0].captured).toBe(false);
  });
});

describe('massacre bonus & storm lightning', () => {
  it('kills build a modest fading XP multiplier that resets out of combat', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.phase = 'cleared'; // drive kills manually
    g.enemies = [];
    expect(g.massacreMult()).toBe(1); // no chain yet
    // Chain up 20 kills
    for (let i = 0; i < 20; i++) {
      const e = g.spawnEnemyAt({ x: 0, y: 0 }, false, 'shade');
      e.spawnT = 0;
      g.dealDamage(e, 1e9, { source: 'strike' });
    }
    expect(g.massacreCount).toBe(20);
    expect(g.massacreMult()).toBeCloseTo(1.14); // +0.7% * 20
    // XP is boosted by the live multiplier (raise the bar so no level-up eats it)
    g.xpNeeded = 1e9;
    const before = g.xp;
    g.gainXP(100);
    expect(g.xp - before).toBeCloseTo(100 * 1.14);
    // Let the window lapse -> chain resets (needs phase 'combat' to tick)
    g.phase = 'combat';
    g.enemies = [];
    stepFrames(g, input, Math.round(MASSACRE_WINDOW_S * 60) + 12);
    expect(g.massacreCount).toBe(0);
    expect(g.massacreMult()).toBe(1);
  });

  it('the XP multiplier is capped low', () => {
    const { g } = createHeadlessGame();
    g.startRun();
    g.massacreCount = 100000;
    expect(g.massacreMult()).toBeCloseTo(1.4); // 1 + capped 0.4
  });

  it('storm lightning comes ONLY from a boon/obelisk, on a 10s cadence', () => {
    const { g, input } = createHeadlessGame();
    g.startRun();
    g.boons = [];
    g.recomputeStats();
    g.setupChamber(2);
    // A lone, immobile foe out of weapon range — only the storm can reach it
    g.weapons = [];
    g.enemies = [];
    g.spawnBudgetUsed = g.quota;
    g.stats.critChance = 0; // a crit could one-shot before the second bolt
    const e = g.spawnEnemyAt({ x: g.player.x + 600, y: g.player.y }, false, 'brute');
    e.spawnT = 0;
    e.speed = 0;
    const hp0 = e.hp;
    // No storm source: no ambient lightning at all (also warms the hash)
    stepFrames(g, input, 12 * 60);
    expect(e.hp).toBe(hp0);
    // Grant Storm Lord -> immediate first bolt, then ~every 10s
    g.mods.stormLord = true;
    stepFrames(g, input, 6); // stormT was 0 -> fires almost at once
    const afterFirst = e.hp;
    expect(afterFirst).toBeLessThan(hp0);
    // Within the next 5s, NO second bolt (proves cadence >> 0.7s)
    stepFrames(g, input, 5 * 60);
    expect(e.hp).toBe(afterFirst);
    // Past the 10s mark, the next bolt lands
    stepFrames(g, input, 6 * 60);
    expect(e.hp).toBeLessThan(afterFirst);
  });
});
