const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://shikimori.one/api/animes/21/episodes');
    console.log(res.data[res.data.length - 1] || res.data); // sample
  } catch (e) {
    console.error(e.message);
  }
}

test();
