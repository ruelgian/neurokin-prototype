# Headless playthrough: creation -> deploy -> events -> AFK -> lethal death -> revive -> expiry.
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
SHOTS = 'shots/'
errors = []
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(URL); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(500)
        S = lambda expr: pg.evaluate(f'(() => {{ const S = window.__nk.S; return {expr}; }})()')
        # 1 identity
        await pg.fill('[data-in=name]', 'NOVA-7')
        await pg.click('.arch[data-arg=phantom]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=SHOTS + '01-create-identity.png')
        await pg.click('[data-act=cstep][data-arg="1"]')
        # 2 attributes: spend 10 points
        for a, n in [('agility', 3), ('insight', 2), ('might', 3), ('will', 2)]:
            for _ in range(n): await pg.click(f'[data-act=attr][data-arg="{a}:1"]')
        await pg.click('[data-act=cstep][data-arg="1"]')
        # 3 orders
        await pg.fill('[data-in=orders]', 'Never enter Lethal activities\nRetreat below 35% HP\nPrioritize loot\nExplore new sectors')
        await pg.click('[data-act=cstep][data-arg="1"]')
        # 4 loadout: add cartographer too
        await pg.click('.mod[data-arg=cartographer]')
        await pg.wait_for_timeout(200)
        await pg.screenshot(path=SHOTS + '02-create-loadout.png')
        await pg.click('[data-act=cstep][data-arg="1"]')
        # 5 consent
        assert await pg.is_disabled('[data-act=createKin]')
        await pg.check('[data-in=agree]'); await pg.fill('[data-in=typed]', 'NOVA-7')
        await pg.screenshot(path=SHOTS + '03-consent.png')
        await pg.click('[data-act=createKin]')
        await pg.wait_for_timeout(300)
        print('created', await S('S.kin.name + " " + S.kin.arch + " mods=" + S.kin.modules.join(",")'))
        # deploy to plaza via zone tap + deploy button, speed x300
        await pg.click('[data-act=dev]'); await pg.click('[data-act=speed][data-arg="300"]'); await pg.click('#dev [data-act=dev]')
        await pg.click('.zone-opt[data-arg=bazaar]')
        await pg.wait_for_timeout(4000)
        await pg.click('[data-act=dev]'); await pg.click('[data-act=event][data-arg=data_boom]'); await pg.click('[data-act=event][data-arg=virus_outbreak]'); await pg.click('[data-act=brain][data-arg=stub]'); await pg.click('#dev [data-act=dev]')
        await pg.wait_for_timeout(5000)
        print('after live', await S('`tick ${S.tickCount} lv ${S.kin.level} hp ${S.kin.hp.toFixed(2)} status ${S.kin.status} zone ${S.kin.zone} fights ${S.kin.stats.fights}/${S.kin.stats.wins} chest ${S.chest.bits} journal ${S.journal.length} events ${S.events.length} thought ${S.lastThought && S.lastThought.provider}`'))
        # tap a zone on the canvas map for intel
        await pg.screenshot(path=SHOTS + '04-world-live.png')
        # journal
        await pg.click('.rail-btn[data-arg=log]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=SHOTS + '05-journal.png')
        # AFK: back to x1, skip 6h
        await pg.click('[data-act=dev]'); await pg.click('[data-act=speed][data-arg="1"]'); await pg.click('[data-act=skip][data-arg="43200000"]'); await pg.click('#dev [data-act=dev]')
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=SHOTS + '06-afk-welcome-back.png')
        await pg.click('[data-act=collectClose]')
        print('after afk', await S('`lv ${S.kin.level} wallet ${S.wallet.bits}/${S.wallet.shards} status ${S.kin.status}`'))
        # Lab upgrades
        await pg.click('.rail-btn[data-arg=lab]'); await pg.wait_for_timeout(200)
        for lab in ['cryo', 'memory', 'compiler']:
            if await pg.is_enabled(f'[data-act=upgrade][data-arg={lab}]'): await pg.click(f'[data-act=upgrade][data-arg={lab}]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=SHOTS + '07-lab.png')
        # Rank + duel
        await pg.click('.rail-btn[data-arg=rank]'); await pg.wait_for_timeout(200)
        await pg.click('[data-act=duel] >> nth=0'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=SHOTS + '08-leaderboard.png')
        # Lethal deploy: blocked by order -> remove -> risk -> deploy
        await pg.click('.rail-btn[data-arg=world]'); await pg.wait_for_timeout(200)
        await pg.click('.zone-opt[data-arg=deadzone]'); await pg.wait_for_timeout(300)
        assert 'BLOCKED' in await pg.inner_text('#overlay')
        await pg.click('[data-act=dropNoLethal]'); await pg.wait_for_selector('#riskgo:not([disabled])', timeout=20000)
        print('risk text:', (await pg.inner_text('#riskbox')).replace('\n', ' '))
        await pg.screenshot(path=SHOTS + '09-lethal-confirm.png')
        await pg.click('#riskgo')
        await pg.click('[data-act=dev]'); await pg.click('[data-act=speed][data-arg="300"]'); await pg.click('#dev [data-act=dev]')
        died = False
        for i in range(180):
            await pg.wait_for_timeout(500)
            st = await S('S.kin.status')
            if st == 'fallen': died = True; break
        if not died:
            print('did not die naturally; forcing'); await pg.click('[data-act=dev]'); await pg.click('[data-act=kill]'); await pg.click('#dev [data-act=dev]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=SHOTS + '10-signal-lost.png')
        await pg.wait_for_timeout(2400)
        await pg.screenshot(path=SHOTS + '11-fallen-countdown.png')
        print('fallen', await S('`zone ${S.kin.fallenZone} deadline in ${((S.kin.fallenAt + 14*864e5 - (Date.now()+S.debugOffset))/864e5).toFixed(2)}d`'))
        # revive quest (retry until success)
        for attempt in range(8):
            await pg.click('[data-act=rescue]')
            for i in range(40):
                await pg.wait_for_timeout(300)
                st = await S('S.kin.status + "|" + (S.kin.rescue ? "r" : "-")')
                if not st.endswith('r'): break
            if st.startswith('lab'): break
        print('after rescue', await S('`status ${S.kin.status} revives ${S.kin.stats.revives} target ${S.kin.target}`'))
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=SHOTS + '12-revived.png')
        # die again and let 14 days expire
        await pg.click('[data-act=dev]'); await pg.click('[data-act=kill]'); await pg.click('#dev [data-act=dev]')
        await pg.wait_for_timeout(2800)
        await pg.click('[data-act=dev]'); await pg.click('[data-act=skip][data-arg="604800000"]'); await pg.wait_for_timeout(800)
        print('after 7d', await S('S.kin ? S.kin.status : "deleted"'))
        await pg.click('[data-act=skip][data-arg="604800000"]'); await pg.click('#dev [data-act=dev]'); await pg.wait_for_timeout(1200)
        print('after 14d', await S('S.kin ? S.kin.status : "deleted"'), await S('S.tombstones.length'))
        await pg.screenshot(path=SHOTS + '13-deleted.png')
        # reload persists
        await pg.reload(); await pg.wait_for_timeout(600)
        print('after reload lab levels', await S('JSON.stringify(S.lab)'), 'kin', await S('!!S.kin'))
        await b.close()
    print('ERRORS:', errors or 'none')
asyncio.run(main())
