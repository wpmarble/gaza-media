/*
  randomizer.js  -- fall 2026 headline-choice experiment

  Attach to a hidden question placed immediately after the pretreatment block
  (sympathy / lean / thermometer) and before the first choice task. Runs once.

  What it does
    1. Seeds a mulberry32 PRNG from a FNV-1a hash of resp_id, so the entire
       assignment is reproducible offline from the ResponseID alone.
    2. Picks one of K_SHARDS headline shards -- pool_shard = seed % K_SHARDS, NOT a
       draw from the PRNG stream, so adding sharding did not move any later draw.
       The shard IS the pool; everything downstream is unchanged.
    3. Fetches that shard, calls assign(), writes every field to embedded data.
    4. Auto-advances. (It no longer warm-fetches articles.json: the read stage is
       parked and renderer.js fetches the small articles file itself.)

  assign(pool, inputs, rng) is PURE: no DOM, no Qualtrics, no Math.random, no Date.
  It returns a plain object whose keys are exactly the embedded-data fields to
  write, plus one diagnostic key "_diag" that the Qualtrics binding skips (any key
  starting with "_" is skipped). Tests call assign() directly.

  RANDOM STREAM ORDER -- fixed, do not reorder; every draw below consumes the one
  mulberry32 stream in this sequence:
      1. arm_volume            (1 draw)
      2. arm_alpha             (1 draw)
      3. arm_valence           (1 draw; if base_side is none this draw sets arm_target instead)
      4. tasks 1..6 in ascending order. Per task:
           unrestricted (1, 2, 6): 1 draw per stratum pick (top, middle, bottom),
                                   then 1 draw per placebo (J - 3 of them),
                                   then J - 1 draws for the Fisher-Yates shuffle of J slots
           restricted   (3, 4, 5): per war slot 2 draws (extreme-vs-middle coin, then pick);
                                   1 draw per placebo; then J - 1 shuffle draws
      (Stream changed 2026-09-22 when J went 4 -> 5 and N_WAR_HIGH 3 -> 4; seeds from
       before that date do not reproduce.)
      5. read_task             (1 draw)
      6. read_own              (1 draw)
      7. read_alt_rank         (1 draw)
      8. q_share_side          (1 draw)  which side the civilian-share slider names
      9. q_side_order          (1 draw)  direction of the which-side-more scale
     10. aid_order             (1 draw)  arms-sale item before or after humanitarian-aid item
  Fallback resolution never consumes an extra draw: the candidate list is resolved
  first, then a single pick draw is taken against it. Nor does the shard choice:
  pool_shard is seed % K_SHARDS, computed from the seed integer (2026-09-24).

  Qualtrics JS environment: ES5 only. No let/const, no arrow functions, no template
  literals, and never the two characters dollar-sign and open-brace adjacent
  anywhere in this file (the piped-text parser would eat it).

  Spec: docs/spec-js-and-build.md sections 3 and 6.
*/

(function (global) {
  "use strict";

  /* ------------------------------------------------------------ constants */

  var HEADLINES_BASE = "https://williammarble.com/gaza-media/fall2026/";
  var K_SHARDS = 10;                        // headlines-shard-0.json ... -9.json

  var N_TASKS = 6;                          // total choice tasks
  var J = 5;                                // alternatives per task (2026-09-22: was 4)
  var UNRESTRICTED_TASKS = [1, 2, 6];       // one top + one middle + one bottom + (J-3) placebos
  var RESTRICTED_TASKS = [3, 4, 5];         // composition set by the arms
  var N_WAR_HIGH = 4;                       // volume arm: war slots per restricted task (2026-09-22: was 3)
  var N_WAR_LOW = 1;
  var W_EXTREME = 0.5;                      // P(draw from the arm's extreme pool) in a
                                            // restricted war slot; 1 - W_EXTREME goes to
                                            // middle (the overlap design, memo section 9)
  var P_READ_OWN = 0.75;                    // P(read the alternative you chose)

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

  /* -------------------------------------------------------------- assign */

  /*
    pool    array of headline objects from headlines.json
    inputs  { resp_id, base_symp, base_lean, rng_seed, rng_seed_fallback }
    rng     function returning a float in [0, 1)
  */
  function assign(pool, inputs, rng) {
    var out = {};
    var diag = { tasks: [], fallbacks: [] };
    var used = {};
    var k, i;

    /* -- baseline side -------------------------------------------------- */
    var bs = baseSide(inputs.base_symp, inputs.base_lean);

    out.resp_id = inputs.resp_id === undefined ? "" : inputs.resp_id;
    out.base_symp = inputs.base_symp === undefined ? "" : inputs.base_symp;
    out.base_lean = inputs.base_lean === undefined ? "" : inputs.base_lean;
    out.base_side = bs.base_side;
    out.base_side_source = bs.base_side_source;
    out.rng_seed = String(inputs.rng_seed === undefined ? "" : inputs.rng_seed);
    out.rng_seed_fallback = inputs.rng_seed_fallback ? 1 : 0;
    out.pool_shard = poolShard(inputs.rng_seed);

    /* -- arms (stream positions 1-3) ------------------------------------ */
    out.arm_volume = rng() < 0.5 ? "high" : "low";
    out.arm_alpha = rng() < 0.5 ? "high" : "low";

    if (bs.base_side !== "none") {
      out.arm_valence = rng() < 0.5 ? "pro" : "counter";
      out.arm_target = out.arm_valence === "pro" ? bs.base_side : otherSide(bs.base_side);
    } else {
      out.arm_valence = "na";
      out.arm_target = rng() < 0.5 ? "pal" : "isr";
    }

    var extremeStratum = out.arm_alpha === "high" ? "top" : "bottom";
    var armStrata = [extremeStratum, "middle"];
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
          task: task, want_stratum: wantStratum, want_side: wantSide,
          depth: res.depth, resolved_stratum: res.stratum
        });
      }
      var h = res.cands[pickIndex(res.cands.length, rng)];
      used[h.id] = 1;
      return h;
    }

    /* -- menus (stream position 4) -------------------------------------- */
    var restrictedWar = [];
    var unrestrictedWar = [];

    for (k = 1; k <= N_TASKS; k++) {
      var slots = [];
      var isRestricted = RESTRICTED_TASKS.indexOf(k) !== -1;
      var nWarThis, nPlaceboThis, s, coin, wantStratum;

      if (isRestricted) {
        nWarThis = nWar;
        for (s = 0; s < nWarThis; s++) {
          coin = rng();
          wantStratum = coin < W_EXTREME ? extremeStratum : "middle";
          var hr = take(restrictedCandidates(wantStratum), k, wantStratum, out.arm_target);
          slots.push(hr);
          restrictedWar.push(hr);
        }
      } else {
        nWarThis = WAR_STRATA.length;
        for (s = 0; s < WAR_STRATA.length; s++) {
          var hu = take(unrestrictedCandidates(WAR_STRATA[s]), k, WAR_STRATA[s], "any");
          slots.push(hu);
          unrestrictedWar.push(hu);
        }
      }

      nPlaceboThis = J - nWarThis;
      for (s = 0; s < nPlaceboThis; s++) {
        var pc = available(pool, used, ["placebo"], null);
        if (pc.length === 0) throw new Error("Placebo pool exhausted at task " + k);
        var hp = pc[pickIndex(pc.length, rng)];
        used[hp.id] = 1;
        slots.push(hp);
      }

      shuffleInPlace(slots, rng);

      var ids = [];
      for (i = 0; i < slots.length; i++) {
        ids.push(slots[i].id);
        out["t" + k + "_h" + (i + 1)] = slots[i].title;
      }
      out["t" + k + "_ids"] = ids.join("|");
      diag.tasks.push({ task: k, restricted: isRestricted, n_war: nWarThis, slots: slots });
    }

    out.n_fallback = nFallback;

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

    /* -- read-stage draws (stream positions 5-7) ------------------------ */
    out.read_task = 1 + pickIndex(N_TASKS, rng);
    out.read_own = rng() < P_READ_OWN ? 1 : 0;
    out.read_alt_rank = 1 + pickIndex(J - 1, rng);

    /* -- question-wording randomizations (stream positions 8-10) ---------- */
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
    /* Order of the two US-aid items (arms sale vs humanitarian aid). */
    out.aid_order = rng() < 0.5 ? "arms_first" : "aid_first";

    out._diag = diag;
    return out;
  }

  /* ------------------------------------------------- Node export / guard */

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      assign: assign,
      baseSide: baseSide,
      fnv1a: fnv1a,
      mulberry32: mulberry32,
      shuffleInPlace: shuffleInPlace,
      poolShard: poolShard,
      shardUrl: shardUrl,
      constants: {
        HEADLINES_BASE: HEADLINES_BASE,
        K_SHARDS: K_SHARDS,
        N_TASKS: N_TASKS,
        J: J,
        UNRESTRICTED_TASKS: UNRESTRICTED_TASKS,
        RESTRICTED_TASKS: RESTRICTED_TASKS,
        N_WAR_HIGH: N_WAR_HIGH,
        N_WAR_LOW: N_WAR_LOW,
        W_EXTREME: W_EXTREME,
        P_READ_OWN: P_READ_OWN
      }
    };
    return;
  }

  /* ----------------------------------------------------- Qualtrics bind */

  if (typeof Qualtrics === "undefined") return;

  Qualtrics.SurveyEngine.addOnload(function () {
    var qThis = this;

    qThis.getQuestionContainer().style.display = "none";
    qThis.hideNextButton();
    qThis.hidePreviousButton();

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

    function clearSpinner() {
      var el = document.getElementById("fall2026Spinner");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function fail(where, err) {
      console.error("randomizer.js failed at " + where + ":", err);
      clearSpinner();
      Qualtrics.SurveyEngine.setEmbeddedData(
        "randomizer_error", where + ": " + (err && err.message ? err.message : String(err))
      );
      var msg = document.createElement("div");
      msg.setAttribute("style", "margin:40px auto; max-width:40em; font-size:16px;");
      msg.appendChild(document.createTextNode(
        "We could not load the survey materials. Please refresh the page. " +
        "If the problem persists, close the survey and contact the researcher."
      ));
      document.body.appendChild(msg);
      qThis.showNextButton();
    }

    var respId = Qualtrics.SurveyEngine.getEmbeddedData("resp_id");
    var seedFallback = 0;
    var seed;
    if (respId === null || respId === undefined || String(respId) === "") {
      seed = fnv1a(String(Date.now()) + ":" + Math.random());
      seedFallback = 1;
    } else {
      seed = fnv1a(String(respId));
    }

    var inputs = {
      resp_id: respId === null || respId === undefined ? "" : String(respId),
      base_symp: Qualtrics.SurveyEngine.getEmbeddedData("base_symp"),
      base_lean: Qualtrics.SurveyEngine.getEmbeddedData("base_lean"),
      rng_seed: seed,
      rng_seed_fallback: seedFallback
    };

    var shard = poolShard(seed);
    var poolUrl = shardUrl(shard);

    fetch(poolUrl, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + poolUrl);
        return r.json();
      })
      .then(function (pool) {
        if (!pool || !pool.length) throw new Error("empty pool shard " + shard);

        var result = assign(pool, inputs, mulberry32(seed));

        var key;
        for (key in result) {
          if (!Object.prototype.hasOwnProperty.call(result, key)) continue;
          if (key.charAt(0) === "_") continue;   /* diagnostics stay client-side */
          Qualtrics.SurveyEngine.setEmbeddedData(key, result[key]);
        }
        Qualtrics.SurveyEngine.setEmbeddedData("randomizer_error", "");

        console.log("fall2026 randomizer: seed=" + result.rng_seed +
                    " shard=" + result.pool_shard + "/" + K_SHARDS +
                    " (" + pool.length + " headlines)" +
                    " arms=" + result.arm_volume + "/" + result.arm_alpha + "/" +
                    result.arm_valence + "/" + result.arm_target +
                    " n_fallback=" + result.n_fallback);
        console.log("fall2026 menus:", result._diag);

        clearSpinner();
        qThis.clickNextButton();
      })
      .catch(function (err) { fail("assign", err); });
  });
})(typeof window !== "undefined" ? window : global);
