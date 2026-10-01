/*
  randomizer.js  -- fall 2026 headline-choice experiment

  Attach to a hidden question placed immediately after the pretreatment block
  (sympathy / lean / thermometer) and before the first choice task. Runs once.

  What it does
    1. Seeds a mulberry32 PRNG from a FNV-1a hash of resp_id, so the entire
       assignment is reproducible offline from the ResponseID alone.
    2. Makes and writes every draw that does NOT need the headline pool (arms,
       wording, conjoint) BEFORE fetching anything, and sets conjoint_shown = "1".
    3. Picks one of K_SHARDS headline shards -- pool_shard = seed % K_SHARDS, NOT a
       draw from the PRNG stream. The shard IS the pool.
    4. Fetches that shard (FETCH_TIMEOUT_MS timeout), builds the six menus, writes
       them, sets headlines_shown = "1".
    5. Auto-advances -- on success AND on failure. On a failed/timed-out fetch it
       writes randomizer_error, leaves headlines_shown = "0", and the survey flow
       skips the headline tasks (and the conjoint if conjoint_shown != "1").

  assign(pool, inputs, rng) is PURE: no DOM, no Qualtrics, no Math.random, no Date.
  It returns a plain object whose keys are exactly the embedded-data fields to
  write, plus one diagnostic key "_diag" that the Qualtrics binding skips (any key
  starting with "_" is skipped). Tests call assign() directly. assign(null, ...)
  returns only the pool-independent fields (headlines_shown = "0"), and they are
  identical to the same fields of assign(pool, ...) for the same seed: the pool
  never touches the main stream (menus use their own sub-stream, below).

  RAND_VERSION "2026-10-01" (exported as rand_version). The stream was
  re-ordered on that date so pool-independent draws precede and do not depend on
  the menus; seeds from before 2026-10-01 do not reproduce (no real respondents
  had been collected).

  RANDOM STREAM ORDER -- fixed, do not reorder. MAIN stream = mulberry32(seed):
      1. arm_volume            (1 draw)
      2. arm_alpha             (1 draw)
      3. arm_valence           (1 draw; if base_side is none this draw sets arm_target instead)
      4. menu_seed             (1 draw) u -> floor(u * 2^32) seeds the MENU sub-stream.
                                         Drawn whether or not the pool loads, so nothing
                                         after it moves when the fetch fails.
      5. q_share_side          (1 draw)  which side the civilian-share slider names
      6. q_side_order          (1 draw)  direction of the which-side-more scale (also used
                                         for the headline-bias item's scale direction)
      7. aid_order             (1 draw)  arms-sale item before or after humanitarian-aid item
      8. cj_row_order          (4 + 1 = 5 draws) display order of the six non-demographic
                                         rows, gaza and human always adjacent. Fisher-Yates
                                         (4 draws) over the five units war, imm, health, abort,
                                         tax; then ONE draw (rng() < 0.5 gives gaza|human,
                                         else human|gaza) expands "war" into the pair.
      9+ conjoint profiles: tasks 1..CJ_TASKS, profile a then b. Per profile:
           party (1 draw), gender (1 draw), age (1 draw), then FIVE issue-row draws
           (gaza, imm, health, abort, tax; one u each: u < CJ_P_NSP gives "nsp", else the
           substantive level is picked by rescaling u). If fewer than CJ_MIN_STATED
           issue rows are stated, ALL five issue draws are redrawn (blocks of 5),
           looping until satisfied. Then ONE human draw LAST (pickIndex(4): pal, isr,
           both, none, each 0.25; not an issue row: no NSP, not counted toward
           CJ_MIN_STATED). Per profile: 3 + 5 (+ 5 per redraw) + 1 draws; minimum
           2*CJ_TASKS*9 over a respondent. The profile string keeps nine codes in
           CJ_ROWS order (human sits right after gaza).
           Iran row cut 2026-09-30 (commented out, reversible): it is not drawn. The loop consumes a variable number of draws, but that number
           is a deterministic function of the seed, so replay is exact. Nothing
           after the conjoint draws exists in the main stream.

  MENU sub-stream = mulberry32(menu_seed), used only when the pool loaded:
      M1. gold reservation: for each unrestricted task in UNRESTRICTED_TASKS order
          (1, 2, 6), 1 draw picking one GOLD war headline (gold === true) uniformly
          among gold headlines not yet reserved. All three are reserved BEFORE any
          task is built, so restricted tasks 3-5 cannot use up task 6's gold
          headline. No gold left: no draw, n_fallback + 1, that task uses the
          old one-per-stratum rule.
      M2. tasks 1..6 in ascending order. Per task:
           unrestricted (1, 2, 6): 1 draw per remaining stratum pick (top, middle,
                                   bottom in that order, skipping the reserved gold
                                   headline's stratum: 2 draws; 3 if no gold),
                                   then 1 draw per placebo (J - 3 of them),
                                   then J - 1 draws for the Fisher-Yates shuffle of J slots
           restricted   (3, 4, 5): per war slot 2 draws (extreme-vs-middle coin, then pick);
                                   1 draw per placebo; then J - 1 shuffle draws
  Fallback resolution never consumes an extra draw: the candidate list is resolved
  first, then a single pick draw is taken against it. Nor does the shard choice:
  pool_shard is seed % K_SHARDS, computed from the seed integer (2026-09-24).
  Earlier stream changes: 2026-09-22 (J 4 -> 5), 2026-09-25 (read stage cut),
  2026-09-30 (conjoint appended), 2026-10-01 (this re-order + gold).

  Qualtrics JS environment: ES5 only. No let/const, no arrow functions, no template
  literals, and never the two characters dollar-sign and open-brace adjacent
  anywhere in this file (the piped-text parser would eat it).

  Spec: docs/spec-js-and-build.md sections 3 and 6.
*/

(function (global) {
  "use strict";

  /* ------------------------------------------------------------ constants */

  var RAND_VERSION = "2026-10-01";          // exported as rand_version; bump on ANY stream change
  var HEADLINES_BASE = "https://williammarble.com/gaza-media/fall2026/";
  var K_SHARDS = 10;                        // headlines-shard-0.json ... -9.json
  var FETCH_TIMEOUT_MS = 15000;             // give up on the shard after this; skip headline tasks

  var N_TASKS = 6;                          // total choice tasks
  var J = 5;                                // alternatives per task (2026-09-22: was 4)
  var UNRESTRICTED_TASKS = [1, 2, 6];       // one top + one middle + one bottom + (J-3) placebos
  var RESTRICTED_TASKS = [3, 4, 5];         // composition set by the arms
  var N_WAR_HIGH = 4;                       // volume arm: war slots per restricted task (2026-09-22: was 3)
  var N_WAR_LOW = 1;
  var W_EXTREME = 0.5;                      // P(draw from the arm's extreme pool) in a
                                            // restricted war slot; 1 - W_EXTREME goes to
                                            // middle (the overlap design, memo section 9)

  /* ---- candidate conjoint (2026-09-30). Draws are appended to the END of the
     stream, so no pre-existing field moves. ----------------------------------- */
  var CJ_TASKS = 4;                         // conjoint tasks (2026-09-30: 3 -> 4; task 4 draws append after task 3, so tasks 1-3 are unchanged)
  var CJ_P_NSP = 0.25;                      // P("No stated position") per issue row
  var CJ_MIN_STATED = 2;                    // min issue rows with a stated position
  /* 2026-09-30: Iran row cut to make room for the speech row; uncomment to restore */
  // var CJ_ROWS = ["party", "gender", "age", "gaza", "iran", "imm", "health", "abort", "tax"];
  // var CJ_ISSUE_ROWS = ["gaza", "iran", "imm", "health", "abort", "tax"];
  var CJ_ROWS = ["party", "gender", "age", "gaza", "human", "imm", "health", "abort", "tax"];
  var CJ_ISSUE_ROWS = ["gaza", "imm", "health", "abort", "tax"];   // rows under the NSP/redraw rule
  var CJ_LEVELS = {
    party: ["dem", "rep"],
    gender: ["man", "woman"],
    age: ["38", "52", "66"],
    gaza: ["pro", "mid", "end"],
    /* 2026-09-30: Iran row cut to make room for the speech row; uncomment to restore */
    // iran: ["end", "cont"],
    human: ["pal", "isr", "both", "none"],   // campaign speech; one draw, 0.25 each, no NSP
    imm: ["deport", "path", "path_ice"],
    health: ["medicare", "market"],
    abort: ["federal", "states"],
    tax: ["raise", "cut"]
  };
  var NSP = "nsp";                          // issue rows only

  /* Which shard a respondent gets. Deterministic in the seed and deliberately NOT
     a draw from the PRNG stream: a draw here would shift every subsequent draw and
     break replay of assignments made before sharding existed. seed is a uint32 and
     K_SHARDS is small, so the modulo is effectively uniform. */
  function poolShard(seed) {
    var s = Number(seed);
    if (!isFinite(s)) s = 0;
    return ((s % K_SHARDS) + K_SHARDS) % K_SHARDS;
  }

  function shardUrl(shard) {
    return HEADLINES_BASE + "headlines-shard-" + shard + ".json";
  }

  /* ------------------------------------------------------------------ rng */

  /* FNV-1a 32-bit. Returns an unsigned 32-bit integer. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    var i;
    for (i = 0; i < str.length; i++) {
      h = h ^ str.charCodeAt(i);
      /* h * 16777619 without overflowing the float53 mantissa */
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /* Math.imul shim: ES2015 in spec, present in every browser Qualtrics supports,
     but keep a portable fallback so the PRNG stream is identical everywhere. */
  var imul = Math.imul || function (a, b) {
    var aHi = (a >>> 16) & 0xffff, aLo = a & 0xffff;
    var bHi = (b >>> 16) & 0xffff, bLo = b & 0xffff;
    return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
  };

  /* mulberry32: small, fast, adequate for treatment assignment. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = imul(t ^ (t >>> 15), t | 1);
      t = t ^ (t + imul(t ^ (t >>> 7), t | 61));
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------- pure helpers */

  function pickIndex(n, rng) {
    return Math.floor(rng() * n);
  }

  /* Fisher-Yates, in place; consumes arr.length - 1 draws. */
  function shuffleInPlace(arr, rng) {
    var i, j, tmp;
    for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* Unused headlines matching a stratum set and (optionally) a side set.
     Pool order is preserved, so the pick index is deterministic. */
  function available(pool, used, strata, sides) {
    var out = [];
    var i, h;
    for (i = 0; i < pool.length; i++) {
      h = pool[i];
      if (used[h.id]) continue;
      if (strata && strata.indexOf(h.stratum) === -1) continue;
      if (sides && sides.indexOf(h.side) === -1) continue;
      out.push(h);
    }
    return out;
  }

  var WAR_STRATA = ["top", "middle", "bottom"];

  /* Baseline side from the two pretreatment items.
       base_symp: 1 Pal, 2 Isr, 3 both, 4 neither
       base_lean: 1 Pal, 2 Isr, 3 can't choose, "" if not asked        */
  function baseSide(symp, lean) {
    var s = String(symp === null || symp === undefined ? "" : symp).trim();
    var l = String(lean === null || lean === undefined ? "" : lean).trim();
    if (s === "1") return { base_side: "pal", base_side_source: "direct" };
    if (s === "2") return { base_side: "isr", base_side_source: "direct" };
    if (l === "1") return { base_side: "pal", base_side_source: "lean" };
    if (l === "2") return { base_side: "isr", base_side_source: "lean" };
    return { base_side: "none", base_side_source: "none" };
  }

  function otherSide(side) {
    return side === "pal" ? "isr" : "pal";
  }

  /* Fixed-precision string so Qualtrics exports 2.2425, not the float's full expansion. */
  function round4(x) {
    return (Math.round(x * 10000) / 10000).toFixed(4);
  }

  /* Pure: draw one candidate profile, returned as nine pipe-joined codes in
     CJ_ROWS order. Issue rows: one draw u each; u < CJ_P_NSP gives NSP, otherwise
     u is rescaled to [0,1) and mapped to a substantive level. Redraws all five
     issue rows until at least CJ_MIN_STATED are stated (variable draw count,
     deterministic given the rng), then draws the human (speech) row once, last. */
  function cjDrawProfile(rng) {
    var codes = [];
    var i, u, lv, n, idx, nStated, issue, human;
    codes.push(rng() < 0.5 ? "dem" : "rep");
    codes.push(rng() < 0.5 ? "man" : "woman");
    codes.push(CJ_LEVELS.age[pickIndex(CJ_LEVELS.age.length, rng)]);
    do {
      issue = [];
      nStated = 0;
      for (i = 0; i < CJ_ISSUE_ROWS.length; i++) {
        u = rng();
        if (u < CJ_P_NSP) {
          issue.push(NSP);
        } else {
          lv = CJ_LEVELS[CJ_ISSUE_ROWS[i]];
          n = lv.length;
          idx = Math.floor((u - CJ_P_NSP) / (1 - CJ_P_NSP) * n);
          if (idx > n - 1) idx = n - 1;
          issue.push(lv[idx]);
          nStated++;
        }
      }
    } while (nStated < CJ_MIN_STATED);
    human = CJ_LEVELS.human[pickIndex(CJ_LEVELS.human.length, rng)];   // drawn LAST
    /* canonical order: party, gender, age, gaza, human, imm, health, abort, tax */
    return codes.concat(issue.slice(0, 1), [human], issue.slice(1)).join("|");
  }

  /* Pure: display order of the six non-demographic rows with gaza and human
     adjacent. Fisher-Yates over five units (4 draws), then one draw for the pair
     direction (rng() < 0.5: gaza first). 5 draws in all. */
  function cjDrawRowOrder(rng) {
    var units = shuffleInPlace(["war", "imm", "health", "abort", "tax"], rng);
    var gazaFirst = rng() < 0.5;
    var out = [];
    var i;
    for (i = 0; i < units.length; i++) {
      if (units[i] === "war") {
        if (gazaFirst) { out.push("gaza", "human"); } else { out.push("human", "gaza"); }
      } else {
        out.push(units[i]);
      }
    }
    return out;
  }


  /* -------------------------------------------------------------- assign */

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /* A gold headline: crowdsourced-alpha-labelled WAR headline. Strict === true so a
     string "FALSE" or "0" from a mis-typed build can never count as gold. */
  function isGold(h) {
    return !!h && h.gold === true && WAR_STRATA.indexOf(h.stratum) !== -1;
  }

  /* Keys assign() returns ONLY when the pool loaded. Every other key it returns is
     pool-independent and identical with or without the pool (test group 8);
     headlines_shown is a flag ("1" with the pool, "0" without). */
  function poolDependentKeys() {
    var ks = ["n_fallback", "r_mean_alpha", "r_share_pal", "r_n_war", "u_mean_alpha",
              "n_gold_shown"];
    var k, j;
    for (k = 1; k <= N_TASKS; k++) {
      ks.push("t" + k + "_ids");
      for (j = 1; j <= J; j++) ks.push("t" + k + "_h" + j);
    }
    return ks;
  }

  /*
    Builds the six menus into `out` from the MENU sub-stream mrng. Pure apart from
    writing into out and diag. Reads out.arm_volume / arm_alpha / arm_target.
  */
  function buildMenus(pool, out, mrng, diag) {
    var used = {};
    var k, i, u;
    var extremeStratum = out.arm_alpha === "high" ? "top" : "bottom";
    var nWar = out.arm_volume === "high" ? N_WAR_HIGH : N_WAR_LOW;
    var nFallback = 0;

    /* Resolve a candidate list for one restricted war slot, walking the
       documented fallback chain. Consumes no draws. */
    function restrictedCandidates(wantStratum) {
      var target = out.arm_target;
      var c = available(pool, used, [wantStratum], [target]);
      if (c.length > 0) return { cands: c, depth: 0, stratum: wantStratum };

      c = available(pool, used, ["middle"], [target]);
      if (c.length > 0) return { cands: c, depth: 1, stratum: "middle" };

      c = available(pool, used, [extremeStratum], [target]);
      if (c.length > 0) return { cands: c, depth: 2, stratum: extremeStratum };

      /* depth 3+: the design restriction is genuinely broken for this slot */
      c = available(pool, used, WAR_STRATA, [target]);
      if (c.length > 0) return { cands: c, depth: 3, stratum: "any" };

      c = available(pool, used, WAR_STRATA, null);
      return { cands: c, depth: 4, stratum: "any" };
    }

    /* Candidate list for one unrestricted war slot (any side). */
    function unrestrictedCandidates(wantStratum) {
      var c = available(pool, used, [wantStratum], null);
      if (c.length > 0) return { cands: c, depth: 0, stratum: wantStratum };
      c = available(pool, used, WAR_STRATA, null);
      return { cands: c, depth: 3, stratum: "any" };
    }

    function take(res, task, wantStratum, wantSide) {
      if (res.cands.length === 0) {
        throw new Error("Headline pool exhausted at task " + task +
                        " (wanted stratum " + wantStratum + ")");
      }
      if (res.depth > 0) {
        nFallback++;
        diag.fallbacks.push({
          kind: "cell", task: task, want_stratum: wantStratum, want_side: wantSide,
          depth: res.depth, resolved_stratum: res.stratum
        });
      }
      var h = res.cands[pickIndex(res.cands.length, mrng)];
      used[h.id] = 1;
      return h;
    }

    /* -- M1: reserve one gold headline per unrestricted task, up front ---- */
    var goldFor = {};
    for (u = 0; u < UNRESTRICTED_TASKS.length; u++) {
      var gc = [];
      for (i = 0; i < pool.length; i++) {
        if (!used[pool[i].id] && isGold(pool[i])) gc.push(pool[i]);
      }
      if (gc.length === 0) {
        /* Should not happen once every shard carries >= 9 gold war headlines.
           No draw is consumed; the task falls back to one-per-stratum. */
        nFallback++;
        diag.fallbacks.push({
          kind: "gold", task: UNRESTRICTED_TASKS[u], want_stratum: "gold",
          want_side: "any", depth: "no_gold", resolved_stratum: "one_per_stratum"
        });
        continue;
      }
      var g = gc[pickIndex(gc.length, mrng)];
      used[g.id] = 1;
      goldFor[UNRESTRICTED_TASKS[u]] = g;
    }

    /* -- M2: tasks 1..6 --------------------------------------------------- */
    var restrictedWar = [];
    var unrestrictedWar = [];
    var nGold = 0;

    for (k = 1; k <= N_TASKS; k++) {
      var slots = [];
      var isRestricted = RESTRICTED_TASKS.indexOf(k) !== -1;
      var nWarThis, nPlaceboThis, s, coin, wantStratum;
      var gold = goldFor[k] || null;

      if (isRestricted) {
        nWarThis = nWar;
        for (s = 0; s < nWarThis; s++) {
          coin = mrng();
          wantStratum = coin < W_EXTREME ? extremeStratum : "middle";
          var hr = take(restrictedCandidates(wantStratum), k, wantStratum, out.arm_target);
          slots.push(hr);
          restrictedWar.push(hr);
        }
      } else {
        nWarThis = WAR_STRATA.length;
        for (s = 0; s < WAR_STRATA.length; s++) {
          var hu;
          if (gold && gold.stratum === WAR_STRATA[s]) {
            hu = gold;                              /* gold fills its own stratum's slot */
          } else {
            hu = take(unrestrictedCandidates(WAR_STRATA[s]), k, WAR_STRATA[s], "any");
          }
          slots.push(hu);
          unrestrictedWar.push(hu);
        }
      }

      nPlaceboThis = J - nWarThis;
      for (s = 0; s < nPlaceboThis; s++) {
        var pc = available(pool, used, ["placebo"], null);
        if (pc.length === 0) throw new Error("Placebo pool exhausted at task " + k);
        var hp = pc[pickIndex(pc.length, mrng)];
        used[hp.id] = 1;
        slots.push(hp);
      }

      shuffleInPlace(slots, mrng);

      var ids = [];
      for (i = 0; i < slots.length; i++) {
        ids.push(slots[i].id);
        out["t" + k + "_h" + (i + 1)] = slots[i].title;
        if (isGold(slots[i])) nGold++;
      }
      out["t" + k + "_ids"] = ids.join("|");
      diag.tasks.push({ task: k, restricted: isRestricted, n_war: nWarThis,
                        gold_id: gold ? gold.id : null, slots: slots });
    }

    out.n_fallback = nFallback;
    out.n_gold_shown = nGold;

    /* -- realized summaries --------------------------------------------- */
    var sumA = 0, nPal = 0;
    for (i = 0; i < restrictedWar.length; i++) {
      sumA += restrictedWar[i].alpha;
      if (restrictedWar[i].side === "pal") nPal++;
    }
    out.r_n_war = restrictedWar.length;
    out.r_mean_alpha = restrictedWar.length ? round4(sumA / restrictedWar.length) : "";
    out.r_share_pal = restrictedWar.length ? round4(nPal / restrictedWar.length) : "";

    var sumU = 0;
    for (i = 0; i < unrestrictedWar.length; i++) sumU += unrestrictedWar[i].alpha;
    out.u_mean_alpha = unrestrictedWar.length ? round4(sumU / unrestrictedWar.length) : "";
  }

  /*
    pool    array of headline objects from a shard, or null when the fetch failed
    inputs  { resp_id, base_symp, base_lean, rng_seed, rng_seed_fallback }
    rng     MAIN stream: function returning a float in [0, 1)
  */
  function assign(pool, inputs, rng) {
    var out = {};
    var diag = { pool_loaded: false, tasks: [], fallbacks: [] };
    var i;

    /* -- baseline side -------------------------------------------------- */
    var bs = baseSide(inputs.base_symp, inputs.base_lean);

    out.rand_version = RAND_VERSION;
    out.resp_id = inputs.resp_id === undefined ? "" : inputs.resp_id;
    out.base_symp = inputs.base_symp === undefined ? "" : inputs.base_symp;
    out.base_lean = inputs.base_lean === undefined ? "" : inputs.base_lean;
    out.base_side = bs.base_side;
    out.base_side_source = bs.base_side_source;
    out.rng_seed = String(inputs.rng_seed === undefined ? "" : inputs.rng_seed);
    out.rng_seed_fallback = inputs.rng_seed_fallback ? 1 : 0;
    out.pool_shard = poolShard(inputs.rng_seed);

    /* -- arms (main stream positions 1-3) ------------------------------- */
    out.arm_volume = rng() < 0.5 ? "high" : "low";
    out.arm_alpha = rng() < 0.5 ? "high" : "low";

    if (bs.base_side !== "none") {
      out.arm_valence = rng() < 0.5 ? "pro" : "counter";
      out.arm_target = out.arm_valence === "pro" ? bs.base_side : otherSide(bs.base_side);
    } else {
      out.arm_valence = "na";
      out.arm_target = rng() < 0.5 ? "pal" : "isr";
    }

    /* -- menu sub-stream seed (main stream position 4; drawn ALWAYS) ---- */
    var menuSeed = Math.floor(rng() * 4294967296) >>> 0;

    /* -- question-wording randomizations (main stream positions 5-7) ----- */
    /* Which side the civilian-death share slider asks about. */
    out.q_share_side = rng() < 0.5 ? "pal" : "isr";
    out.share_side_word = out.q_share_side === "pal" ? "Palestinian" : "Israeli";      /* helper */
    out.share_side_other = out.q_share_side === "pal" ? "Israeli" : "Palestinian";     /* helper */
    /* Direction of the which-side-suffered-more scale. */
    out.q_side_order = rng() < 0.5 ? "pal_first" : "isr_first";
    var palFirst = [
      "Palestinians suffered <strong>far more</strong> civilian deaths",
      "Palestinians suffered <strong>somewhat more</strong> civilian deaths",
      "About the same on both sides",
      "Israelis suffered <strong>somewhat more</strong> civilian deaths",
      "Israelis suffered <strong>far more</strong> civilian deaths"
    ];
    var sideLabels = out.q_side_order === "pal_first" ? palFirst : palFirst.slice().reverse();
    for (i = 0; i < sideLabels.length; i++) out["side_c" + (i + 1)] = sideLabels[i];       /* helpers */
    /* Headline-bias item (pilot QID8 wording) runs in the same direction; no extra draw. */
    var biasPalFirst = [
      "Strongly biased toward Palestinians",
      "Somewhat biased toward Palestinians",
      "Not biased toward either side",
      "Somewhat biased toward Israelis",
      "Strongly biased toward Israelis"
    ];
    var biasLabels = out.q_side_order === "pal_first" ? biasPalFirst : biasPalFirst.slice().reverse();
    for (i = 0; i < biasLabels.length; i++) out["bias_c" + (i + 1)] = biasLabels[i];       /* helpers */
    /* Order of the two US-aid items (arms sale vs humanitarian aid). */
    out.aid_order = rng() < 0.5 ? "arms_first" : "aid_first";

    /* -- candidate conjoint (main stream positions 8+) -------------------- */
    out.cj_row_order = cjDrawRowOrder(rng).join("|");
    var t, pi, profiles = ["a", "b"];
    for (t = 1; t <= CJ_TASKS; t++) {
      for (pi = 0; pi < profiles.length; pi++) {
        out["cj" + t + "_" + profiles[pi]] = cjDrawProfile(rng);
      }
    }
    out.conjoint_shown = "1";

    /* -- menus (MENU sub-stream; only with a pool) ------------------------ */
    out.headlines_shown = "0";
    if (pool === null || pool === undefined) {
      out._diag = diag;
      return out;
    }
    if (Object.prototype.toString.call(pool) !== "[object Array]" || pool.length === 0) {
      throw new Error("pool is not a non-empty array");
    }
    buildMenus(pool, out, mulberry32(menuSeed), diag);
    diag.pool_loaded = true;
    out.headlines_shown = "1";

    out._diag = diag;
    return out;
  }

  /* ------------------------------------------------------------ binding */

  /*
    runBinding(env): the whole Qualtrics-side procedure, with every side effect
    injected so the Node tests can drive it with a fake engine, fake fetch and fake
    timers (test group 8). env:
      engine        { getEmbeddedData(k), setEmbeddedData(k, v) }   (Qualtrics.SurveyEngine)
      question      { clickNextButton() }                           (the question's this)
      fetch         function(url, opts) -> Promise, or null when unavailable
      setTimeout, clearTimeout, now() (ms), random(), ui { clear() } (optional), log (optional)

    Order: flags to "0" -> pool-independent fields (+ conjoint_shown "1") -> fetch
    with timeout -> menus + headlines_shown "1" -> advance. Any failure: write
    randomizer_error, leave headlines_shown "0", advance. Advances at most once;
    a fetch that settles after the timeout writes nothing.
  */
  function runBinding(env) {
    var Q = env.engine;
    var qThis = env.question;
    var log = env.log || function () {};
    var finished = false;
    var timer = null;
    var state = { seed: null, url: null, advanced: 0 };

    function set(k, v) { Q.setEmbeddedData(k, v); }

    /* Every non-underscore key except the two flags, which are written last. */
    function writeFields(obj) {
      var key;
      for (key in obj) {
        if (!has(obj, key)) continue;
        if (key.charAt(0) === "_") continue;
        if (key === "headlines_shown" || key === "conjoint_shown") continue;
        set(key, obj[key]);
      }
    }

    function advance() {
      if (finished) return;
      finished = true;
      if (timer !== null) {
        try { env.clearTimeout(timer); } catch (e0) { /* ignore */ }
        timer = null;
      }
      try { if (env.ui) env.ui.clear(); } catch (e1) { /* ignore */ }
      state.advanced++;
      try { qThis.clickNextButton(); } catch (e2) { log("clickNextButton failed", e2); }
    }

    function fail(where, err) {
      if (finished) { log("fall2026 randomizer: ignored after advance (" + where + ")", err); return; }
      var msg = where + ": " + (err && err.message ? err.message : String(err));
      log("fall2026 randomizer failed at " + msg);
      try { set("headlines_shown", "0"); } catch (e3) { /* ignore */ }
      try { set("randomizer_error", msg); } catch (e4) { /* ignore */ }
      advance();
    }

    try {
      /* A run that dies anywhere below leaves both flags at "0", so the flow skips. */
      set("headlines_shown", "0");
      set("conjoint_shown", "0");
      set("randomizer_error", "");

      var respId = Q.getEmbeddedData("resp_id");
      var seedFallback = 0;
      var seed;
      if (respId === null || respId === undefined || String(respId) === "") {
        seed = fnv1a(String(env.now()) + ":" + env.random());
        seedFallback = 1;
      } else {
        seed = fnv1a(String(respId));
      }
      state.seed = seed;

      var inputs = {
        resp_id: respId === null || respId === undefined ? "" : String(respId),
        base_symp: Q.getEmbeddedData("base_symp"),
        base_lean: Q.getEmbeddedData("base_lean"),
        rng_seed: seed,
        rng_seed_fallback: seedFallback
      };

      /* Pool-independent fields, written before any network access. */
      var base = assign(null, inputs, mulberry32(seed));
      writeFields(base);
      set("conjoint_shown", "1");

      var shard = poolShard(seed);
      var poolUrl = shardUrl(shard);
      state.url = poolUrl;

      timer = env.setTimeout(function () {
        timer = null;
        fail("timeout", new Error("no pool after " + FETCH_TIMEOUT_MS + " ms from " + poolUrl));
      }, FETCH_TIMEOUT_MS);

      var onPool = function (pool) {
        if (finished) { log("fall2026 randomizer: late pool ignored"); return; }
        if (!pool || !pool.length) throw new Error("empty pool shard " + shard);
        var full = assign(pool, inputs, mulberry32(seed));
        var key;
        var extra = {};
        for (key in base) {
          if (!has(base, key) || key.charAt(0) === "_" || key === "headlines_shown") continue;
          if (full[key] !== base[key]) throw new Error("pool-independent field moved: " + key);
        }
        /* Write only what the pool added (the base fields are already written and
           were just checked equal), so conjoint_shown stays after every cj write. */
        for (key in full) {
          if (has(full, key) && !has(base, key)) extra[key] = full[key];
        }
        writeFields(extra);
        set("headlines_shown", "1");
        log("fall2026 randomizer: seed=" + full.rng_seed +
            " shard=" + full.pool_shard + "/" + K_SHARDS +
            " (" + pool.length + " headlines)" +
            " arms=" + full.arm_volume + "/" + full.arm_alpha + "/" +
            full.arm_valence + "/" + full.arm_target +
            " n_fallback=" + full.n_fallback + " n_gold_shown=" + full.n_gold_shown);
        log("fall2026 menus:", full._diag);
        advance();
      };

      if (typeof env.fetch !== "function") throw new Error("fetch unavailable");
      env.fetch(poolUrl, { cache: "no-store" })
        .then(function (r) {
          if (finished) return null;
          if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?") + " for " + poolUrl);
          return r.json();
        })
        .then(function (pool) {
          if (finished) { log("fall2026 randomizer: late response ignored"); return; }
          onPool(pool);
        })
        .then(null, function (err) { fail("fetch", err); });
    } catch (e) {
      fail("binding", e);
    }
    return state;
  }

  /* ------------------------------------------------- Node export / guard */

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      assign: assign,
      buildMenus: buildMenus,
      runBinding: runBinding,
      poolDependentKeys: poolDependentKeys,
      isGold: isGold,
      baseSide: baseSide,
      fnv1a: fnv1a,
      mulberry32: mulberry32,
      shuffleInPlace: shuffleInPlace,
      poolShard: poolShard,
      cjDrawProfile: cjDrawProfile,
      cjDrawRowOrder: cjDrawRowOrder,
      shardUrl: shardUrl,
      constants: {
        RAND_VERSION: RAND_VERSION,
        FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS,
        HEADLINES_BASE: HEADLINES_BASE,
        K_SHARDS: K_SHARDS,
        N_TASKS: N_TASKS,
        J: J,
        UNRESTRICTED_TASKS: UNRESTRICTED_TASKS,
        RESTRICTED_TASKS: RESTRICTED_TASKS,
        N_WAR_HIGH: N_WAR_HIGH,
        N_WAR_LOW: N_WAR_LOW,
        W_EXTREME: W_EXTREME,
        CJ_TASKS: CJ_TASKS,
        CJ_P_NSP: CJ_P_NSP,
        CJ_MIN_STATED: CJ_MIN_STATED,
        CJ_ROWS: CJ_ROWS,
        CJ_ISSUE_ROWS: CJ_ISSUE_ROWS,
        CJ_LEVELS: CJ_LEVELS,
        NSP: NSP
      }
    };
    return;
  }

  /* ----------------------------------------------------- Qualtrics bind */

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;
    var advancedHere = false;

    try {
      qThis.getQuestionContainer().style.display = "none";
      qThis.hideNextButton();
      qThis.hidePreviousButton();
    } catch (e0) { /* cosmetic */ }

    var ui = { clear: function () {} };
    try {
      var spinner = document.createElement("div");
      spinner.setAttribute("id", "fall2026Spinner");
      spinner.setAttribute(
        "style",
        "border:8px solid #f3f3f3; border-top:8px solid #3498db; border-radius:50%;" +
        " width:50px; height:50px; animation:spin 1s linear infinite; margin:50px auto;"
      );
      document.body.appendChild(spinner);
      var style = document.createElement("style");
      style.innerHTML =
        "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
      document.head.appendChild(style);
      ui.clear = function () {
        var el = document.getElementById("fall2026Spinner");
        if (el && el.parentNode) el.parentNode.removeChild(el);
      };
    } catch (e1) { /* cosmetic */ }

    var state = null;
    try {
      state = runBinding({
        engine: Qualtrics.SurveyEngine,
        question: {
          clickNextButton: function () { advancedHere = true; qThis.clickNextButton(); }
        },
        fetch: typeof fetch === "function" ? function (u, o) { return fetch(u, o); } : null,
        setTimeout: function (f, ms) { return setTimeout(f, ms); },
        clearTimeout: function (h) { clearTimeout(h); },
        now: function () { return Date.now(); },
        random: function () { return Math.random(); },
        ui: ui,
        log: function (a, b) {
          if (b === undefined) console.log(a); else console.log(a, b);
        }
      });
    } catch (e2) {
      /* runBinding catches internally; this is the last line of defence. */
      console.error("randomizer.js binding threw:", e2);
      if (!advancedHere) {
        try {
          Qualtrics.SurveyEngine.setEmbeddedData("randomizer_error",
            "outer: " + (e2 && e2.message ? e2.message : String(e2)));
        } catch (e3) { /* ignore */ }
        ui.clear();
        qThis.clickNextButton();
      }
    }
    return state;
  });
})(typeof window !== "undefined" ? window : global);
