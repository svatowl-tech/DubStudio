const axios = require('axios');
async function test() {
  const malId = 21; // One Piece
  const ep = 1050;
  try {
    const res = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/episodes/${ep}`);
    console.log(res.data.data.title);
  } catch (e) {
    console.log(e.message);
  }
}
test();
