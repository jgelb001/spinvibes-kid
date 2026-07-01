# Kid Section — Data Model, Economy v1, Integration (prototype)

> Companion to `spinvibes-kid/index.html` (the working kid prototype). Governed by
> `KID-REWARD-SYSTEM.md` + the no-guilt rule + the COPPA posture in `ROADMAP-TO-LAUNCH.md`.
> The data layer here is **deliberately minimal + swappable**: everything goes through the
> `KidStore` object in index.html (localStorage today). No consent flow is wired —
> that architecture is **gated on the lawyer's COPPA classification**.

## Principles encoded in the prototype
- **No guilt, ever.** Counters only go up; markers never come down; no streak resets are
  surfaced (drill milestones are cumulative 7/14/30, same as the iOS `record_daily_drill` design).
- **No gambling primitives.** No randomness in any reward. Coins earned only, never purchasable.
- **Data minimization.** The kid record is nickname + age band + avatar JSON. No birthdate,
  no address (parent-side only), no free-text from under-13 kids.
- **Parent-gated physical rewards.** Kid sees "ask a grown-up"; the approval + address live
  on the parent side. Prototype gate = press-and-hold 3s stand-in; **final mechanism per counsel.**

## Client state (KidStore key `svkid-state`)
```js
{
  avatar:   { ball, eyes, nose, mouth },          // free at creation
  wear:     { hat, gloves, shoes, decal, scene }, // equipped unlock ids (null = none)
  coins:    int,                                  // earned-only balance
  owned:    [unlock ids],                         // permanent
  decor:    [unlock ids placed on the Clubhouse wall],
  pts:      int,                                  // kid leveling points (9-level system)
  drills:   { count, last },                      // cumulative + last-done date (1/day)
  rounds, famRounds,
  checkins: { count, last },
  markers:  { markerId: earnedISO },              // the wall; never removed
  physicals:{ markerId: 'earned' | 'approved' }   // physical-tier fulfillment state
}
```

## Supabase target shape (when the lawyer answer lands)
Reuses what exists; two new tables.

| Concern | Where it goes |
|---|---|
| markers earned | **existing `markers` table** + `get_markers` RPC (session 47) |
| daily drills + 7/14/30 grants | **existing `daily_drill_log`** + `record_daily_drill` RPC (atomic count + milestone grant) |
| leveling points | derived from rounds (`kidPointsFromRounds`, app index.html ~1116) + bonus — do NOT store a parallel counter |
| coins | **new `kid_coin_ledger`** (guide_user_id, member_slug, delta, reason, created_at) — balance = SUM; append-only = auditable + never-negative by RPC guard |
| unlocks/equips | **new `kid_unlocks`** (guide_user_id, member_slug, item_id, equipped bool, slot) |
| physical redemptions | **new `physical_redemptions`** (guide_user_id, member_slug, marker_id, tier tee/marker/ball, status earned→parent_approved→shipped, approved_at) — **address never in this table**; fulfillment reads the parent-provided address at ship time |

Same RLS posture as `markers`/`daily_drill_log`: zero kid PII, anon SELECT denied,
security-definer RPCs scoped by the family's guide-link UUID.
Suggested RPCs: `kid_earn(action)`, `kid_spend(item_id)`, `kid_equip(item_id)`,
`approve_physical(marker_id)` (parent-authenticated only).

## Economy v1 (proposed — tune freely, all in `EARN` + `CATALOG` in index.html)
**Earn (meaningful actions only, never screen time):**

| Action | Coins | Level pts | Cap |
|---|---|---|---|
| Daily drill done | 5 | 1 | 1/day |
| Finished a round | 20 | 3 | — |
| Family round bonus | 10 | +1 | — |
| Check-in | 3 | 0 | 1/day |
| Marker earned | 15 | 0 | auto |
| Level up | 25 | — | auto |
| Par or better | 0 | +2 | — |

Typical active week ≈ 5 drills + 1 round + 2 check-ins ≈ **56 coins/week**.

**Spend (prices, raised 2026-07-01 per Jeremy):** decals 24–34 · gloves 28 · hats 34–45 ·
shoes 44–50 · **club customizations 24–32** (grips 24–32, head paint 28–30) · Clubhouse decor
28–65 · scenes 65–85. → roughly 1–2 unlocks/week for an active kid; scenes ≈ a two-week save.
**Club TYPES are never for sale** — putter → iron (L2) → driver (L5) → tour driver (L8),
earned by leveling only (kids start with the **putter**). Coins buy *customizations for the
club you've earned* (grip colors, head paint — more later: shaft wraps, headcovers, charms),
so the level reward and the coin economy reinforce each other instead of competing.

**Level system:** ported 1:1 from app.spinvibes.com (`KID_LEVELS`, thresholds
[4,12,25,42,65,95,130,170], L0 Fresh Caddie → L8 Tour Bound).

**Physical tiers wired in the prototype:** first full 9 → **Tee** · 30 drills → **Marker** ·
first par → **Ball** (crown jewel). Real milestone map scales by level per KID-REWARD-SYSTEM.md.

## App integration (Jeremy's ask: avatar visible IN the app, links out)
Paste-ready snippet for the kid home in `spinvibes-app/index.html` (add once the kid
section has a deploy URL — e.g. `kids.spinvibes.com`). Renders the kid's saved ball as a
tappable chip:

```html
<!-- kid avatar chip → the Clubhouse (kid section) -->
<div class="card" style="display:flex;align-items:center;gap:12px;cursor:pointer"
     onclick="location.href='https://kids.spinvibes.com'">
  <span class="mk" style="width:54px;height:54px"><span class="mk-face"
    style="background:var(--kid-ball-color, #F2A0BC)"><!-- mini ball face svg --></span></span>
  <div style="flex:1">
    <div class="card-title">Your Clubhouse</div>
    <div class="card-body">Your ball is waiting — new marker to go get!</div>
  </div>
</div>
```
Avatar JSON syncs through the same guide-link profile so the app can draw the real
ball+face (share the `avatarSvg()` builder when integrating). **Not added to the live app
yet** — no deploy URL exists; flagged for the deploy session.

## Needs the lawyer's answer before shipping (do NOT build ahead)
1. Consent + kid-device pairing architecture (Phase 1, ROADMAP-TO-LAUNCH.md).
2. Whether ANY kid free-text is allowed (prototype has none; keep it that way for u13).
3. Physical-reward address flow (parent app side) + the approved parent-verification
   mechanism (the press-and-hold gate is a stand-in, not a compliance control).
4. Whether the kid section ships as its own origin (kids.spinvibes.com) or inside the app —
   affects the "directed to children" surface analysis.

## Deploy notes
- Static PWA: `index.html` + `manifest.json` + `sw.js` + `icons/`. Same GitHub Pages
  pattern as the other properties; bump `CACHE` in sw.js per deploy.
- Fonts load from Google Fonts (same as app). No other external requests. No tracking, no ads.
