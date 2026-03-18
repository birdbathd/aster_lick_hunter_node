# Two-Stage Liquidation Mode — Design Notes

> Status: **Design only — not yet implemented**  
> Date: March 10, 2026

---

## Concept

A per-symbol mode where a **large liquidation arms a window**, and actual trade entries only fire on **smaller follow-through liquidations** during that window.

The large liq identifies a supply/demand zone. Smaller liqs confirm price is still trading through it. This gets better entries deeper in the zone rather than entering on the initial spike.

---

## How It Works

1. A liquidation ≥ `twoStageTriggerThresholdUSDT` fires → window opens for that side (LONG or SHORT independently)
2. During the window, any liq ≥ `twoStageTriggerThresholdUSDT × twoStageEntryRatio` fires an entry (same logic as current mode)
3. Window extends if another large liq (≥ trigger) fires while already armed — resets the clock
4. Window expires after `twoStageWindowSeconds` of no re-arm
5. Both sides can be armed independently and simultaneously

**Key rules:**
- Trigger liq does NOT open a position itself — only arms the window
- Entry liqs respect VWAP protection (same as current behavior)
- SL/TP based on entry price, not trigger price
- Max entries capped by existing `maxTranches` per symbol — no separate limit needed
- Short liq → arm SHORT window → only fire SHORT entries (ignore long liqs unless large enough to arm LONG separately)

---

## Config Shape (per symbol)

```json
{
  "twoStageMode": true,
  "twoStageTriggerThresholdUSDT": 30000,
  "twoStageEntryRatio": 0.05,
  "twoStageWindowSeconds": 7200
}
```

| Field | Description | Notes |
|---|---|---|
| `twoStageMode` | Enable/disable two-stage for this symbol | `false` = current behavior |
| `twoStageTriggerThresholdUSDT` | Large liq size that arms the window | Per symbol — replaces single threshold |
| `twoStageEntryRatio` | Entry fires on liqs ≥ this × trigger | e.g. 0.05 = 5% of trigger |
| `twoStageWindowSeconds` | How long window stays armed | Recommended: 7200 (2h), up to 14400 (4h) for illiquid symbols |

Existing `longVolumeThresholdUSDT` / `shortVolumeThresholdUSDT` are **replaced** by this system when `twoStageMode: true`.

---

## Zone Duration Analysis

Analysis run against 3 months of liquidation data (Dec 10, 2025 – Mar 10, 2026, ~62K events).

**Zone duration** = minutes from trigger liq until first 30-min quiet gap with no qualifying entry liqs.

```
Symbol         Trigger$     N      P10m   Median  P75m   P90m   Avg#entries  NoFollowOn
HYPEUSDT       $20,000      23     0      25      171    301    1.7          1
HYPEUSDT       $50,000      5      0      6       6      123    1.8          4
SOLUSDT        $50,000      66     1      44      129    299    3.1          13
SOLUSDT        $200,000     11     0      51      126    148    1.6          5
ASTERUSDT      $50,000      27     1      20      55     133    3.7          6
ASTERUSDT      $200,000     2      11     11      11     11     4.5          1
ETHUSDT        $200,000     121    1      27      65     152    3.2          9
ETHUSDT        $1,000,000   13     0      37      49     156    2.0          3
BTCUSDT        $500,000     33     0      12      30     59     2.7          5
BTCUSDT        $2,000,000   7      0      3       11     29     1.1          1
ZECUSDT        $5,000       101    0      19      107    239    2.9          27
ZECUSDT        $20,000      12     0      0       52     103    3.0          8
```

**Parameters used:**
- Entry ratio: 5% of trigger threshold
- Max look-forward: 8 hours
- 30-min debounce between triggers (same side)
- Zone "dead" = first 30-min gap with no qualifying liq

**Key findings:**
- **Medians are short (3–51 min)** — most zone action is front-loaded
- **Tail is long (P90: 29–301 min)** — the "grinding supply zone" days are real but not the norm
- **BTC cools fastest** — 12 min median even at $500K trigger; very efficient market
- **HYPE/SOL/ZEC have longest-lasting zones** — illiquid = zone stays relevant longer
- **Avg entries/zone is 1.1–3.7** — `maxTranches` naturally caps exposure without a separate limit

**Window recommendation:** 
- Default `twoStageWindowSeconds: 7200` (2h) — covers P75–P90 on most symbols
- Use `14400` (4h) for HYPE/SOL/ZEC to catch the multi-hour grind events
- Relies on window re-arm (new large liq resets clock) to extend naturally

---

## Suggested Starting Config Per Symbol

| Symbol | Trigger$ | Entry ratio | Window |
|---|---|---|---|
| HYPEUSDT | $20,000 | 0.05 (=$1,000 min) | 7200s |
| SOLUSDT | $50,000 | 0.05 (=$2,500 min) | 10800s |
| ASTERUSDT | $50,000 | 0.05 (=$2,500 min) | 7200s |
| ETHUSDT | $200,000 | 0.05 (=$10,000 min) | 7200s |
| BTCUSDT | $500,000 | 0.05 (=$25,000 min) | 3600s |
| ZECUSDT | $5,000 | 0.05 (=$250 min) | 14400s |

---

## Implementation Notes (when ready)

- New state in `Hunter`: `armedWindows: Map<string, { side: 'BUY'|'SELL', expiresAt: number }[]>` (keyed by symbol)
- On each liq event: check if ≥ trigger → arm/extend; check if armed + ≥ entry min → pass to existing order logic
- Trigger liqs that are also ≥ entry min during an armed window: treat as entry, not re-arm (avoid double-counting)
- Window state is in-memory only (resets on bot restart) — acceptable since windows are short
- UI: show armed state in LiquidationFeed or position panel (e.g. "HYPE SHORT armed 1h42m remaining")
- The `NoFollowOn` column above (triggers that produced zero follow-ons) means the trigger fired but price didn't continue — this is fine, the window just expires unused
