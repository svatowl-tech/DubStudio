const Anime365Service = require('./electron/services/Anime365Service.cjs');

async function test() {
  const seriesList = await Anime365Service.getSeries({ query: 'naruto', limit: 1 });
  console.log(JSON.stringify(seriesList[0] || null, null, 2));
}

test().catch(console.error);
