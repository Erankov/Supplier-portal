// Waits until the deployed site serves the version that is in this repo (Netlify takes a minute or two).
const { siteVersion } = require('./specs/helpers');

const url = (process.env.LIVE_URL || '').replace(/\/$/, '');
const want = siteVersion();
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 1; i <= 40; i++) {
    try {
      const html = await (await fetch(url + '/?v=' + Date.now(), { cache: 'no-store' })).text();
      const src = (html.match(/src="\.?\/?(assets\/[^"]+\.js)"/) || [])[1];
      const js = src ? await (await fetch(url + '/' + src, { cache: 'no-store' })).text() : '';
      const got = (js.match(/\bei="(\d+\.\d+)"/) || [])[1];
      console.log(`try ${i}: live version ${got || '?'}, waiting for ${want}`);
      if (got === want) return;
    } catch (e) {
      console.log(`try ${i}: ${e.message}`);
    }
    await sleep(15_000);
  }
  console.error(`the live site never showed version ${want}`);
  process.exit(1);
})();
