# NEUROKIN · playable prototype (v0.1)

Original sci-fi AI-agent AFK/building game. Vertical slice of the NEUROKIN design doc v0.2.

**Play:** https://ruelgian.github.io/neurokin-prototype/ (landscape; on iPhone use Safari → Share → Add to Home Screen).

Hosting: GitHub Pages serves `docs/` on `main` (a copy of the `dist/` build). Rebuild with `npm run build && rm -rf docs && cp -r dist docs && touch docs/.nojekyll`.
Vite + TypeScript + plain Canvas 2D (procedural neon art, no external assets, no network calls).

## Run
```bash
npm install
npm run dev        # http://localhost:5173 (also on LAN with --host)
npm run build      # -> dist/ (single static folder, relative paths, works from any sub-path)
npm run preview    # serves dist/ on :4173
python3 playtest.py  # headless Chromium playthrough -> shots/*.png (needs preview running)
```

## What's in the slice
- **Kin creation**: name, 5 archetypes, 10 attribute points over 6 attributes, Careful↔Bold slider, Standing Orders (≤5 lines, parsed into fixed rules with chips), starter loadout, **unskippable permadeath consent** (checkbox + type the name; record stored with terms version).
- **Loadout / prompt budget**: 15 skill modules, each a vetted prompt fragment with a token cost. Budget = core 260 + Standing Orders tokens + modules ≤ 1000 (+120 per Memory Bank level). Tag synergies (Killbox, Deep Recall, Prospector, Dealmaker, Field Medic) and contradictions (−12% decision quality).
- **The Lab**: Compiler (craft tiers, −5% module tokens/level), Sim Deck (+XP, attribute training), Memory Bank (+context tokens, recall, journal size), Cryo Vault (AFK chest cap 12h→24h, Revive Tokens, Death Ward). Isometric canvas diorama; tap pods.
- **World sim**: 6 zones (2 Safe, 2 Perilous, 2 Lethal) on a neon map. Deterministic seeded ticks (`src/sim.ts`). Utility-AI "instinct" scores fight/sneak/talk/scavenge/explore/rest/retreat/event/travel from attributes, personality, modules and parsed orders. "Auto" lets the Kin pick its own zone.
- **SYSOP director**: proposes typed events (virus_outbreak, blackout, tournament, breach, data_boom, bounty); a validator enforces rules (no lethal events in Safe zones, Breach announced 4 ticks ahead, ≤3 concurrent).
- **LLM decision interface** (`src/brain.ts`): `DecisionProvider` consulted only at decision points (world event, elite encounter, HP crisis). The next tick is "peeked" on a clone (same seed → same observation), the provider returns an action from the legal enum, anything invalid/slow falls back to instinct. Providers: offline **stub** (default off; enable in DEV) and optional **local Ollama** adapter (only selectable if an Ollama server answers on 127.0.0.1:11434; picks the smallest installed model). Thought trace + prompt shown in WORLD tab.
- **AFK**: on return/time-skip the elapsed real time is simulated tick-by-tick (1 tick = 20 s in the prototype; design target 10 min), capped by the chest. "Welcome back" summary + highlights, journal written as story beats, Fast Reward (2h burst, once per day).
- **Permadeath**: only Lethal zones (or Perilous with a "never retreat" order) can kill. Lethal deploy is blocked by the default "Never enter Lethal activities" order until you remove it; then a Monte-Carlo risk estimate (per expedition + per 12h shift) is shown. Death → "SIGNAL LOST" → 14-day countdown, Last Light companion lines (neutral, no pay pressure), free retryable **Revive Quest**, flat-price **Revive Token**, half level-XP penalty, export any time. At expiry: Kin, journal and modules purged, anonymous tombstone kept, Lab/wallet kept.
- **Leaderboard**: 5 AI rival Kin that level and occasionally fall; async best-of-3 duels with Elo.
- **Persistence**: `localStorage` (`neurokin.save.v1`). **DEV panel**: sim speed ×1/×10/×60/×300, time skip (+1h…+14d), cheats, force SYSOP events, force death, provider switch, wipe.
