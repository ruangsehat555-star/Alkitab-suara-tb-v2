const BASE_URL = 'https://use.apiindonesia.id/api/v1/alkitab';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function normalizeName(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}

function bookMatches(candidate, book) {
  const a = normalizeName(candidate);
  const b = normalizeName(book.name);
  const abbr = normalizeName(book.abbr);
  if (a === b || a === abbr) return true;
  // Accept common spoken forms for numbered Bible books.
  const aliases = {
    '1 korintus': ['i korintus', 'pertama korintus', 'satu korintus'],
    '2 korintus': ['ii korintus', 'kedua korintus', 'dua korintus'],
    '1 tesalonika': ['pertama tesalonika', 'satu tesalonika'],
    '2 tesalonika': ['kedua tesalonika', 'dua tesalonika'],
    '1 timotius': ['pertama timotius', 'satu timotius'],
    '2 timotius': ['kedua timotius', 'dua timotius'],
    '1 petrus': ['pertama petrus', 'satu petrus'],
    '2 petrus': ['kedua petrus', 'dua petrus'],
    '1 yohanes': ['pertama yohanes', 'satu yohanes'],
    '2 yohanes': ['kedua yohanes', 'dua yohanes'],
    '3 yohanes': ['ketiga yohanes', 'tiga yohanes']
  };
  return (aliases[b] || []).some(alias => a === alias);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json({ error: 'Gunakan metode GET.' }, 405);
  const apiKey = process.env.API_INDONESIA_KEY;
  if (!apiKey) return json({ error: 'API key belum dipasang. Tambahkan API_INDONESIA_KEY di Netlify Site configuration > Environment variables, lalu deploy ulang.' }, 500);

  const params = event.queryStringParameters || {};
  const requestedBook = (params.book || '').trim();
  const chapter = Number(params.chapter || 1);
  const start = params.start === undefined ? null : Number(params.start);
  const end = params.end === undefined ? start : Number(params.end);
  if (!requestedBook) return json({ error: 'Nama kitab belum diisi.' }, 400);
  if (!Number.isInteger(chapter) || chapter < 1) return json({ error: 'Nomor pasal harus bilangan bulat positif.' }, 400);
  if (start !== null && (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start)) {
    return json({ error: 'Rentang ayat tidak valid.' }, 400);
  }

  const headers = { 'x-api-key': apiKey, 'Accept': 'application/json' };
  try {
    const booksResponse = await fetch(`${BASE_URL}/books`, { headers });
    const booksPayload = await booksResponse.json().catch(() => ({}));
    if (!booksResponse.ok) return json({ error: booksPayload.message || booksPayload.error || `API Indonesia gagal memuat daftar kitab (HTTP ${booksResponse.status}).` }, 502);
    const books = booksPayload.data || [];
    const book = books.find(item => bookMatches(requestedBook, item));
    if (!book) {
      const partial = books.find(item => normalizeName(item.name).includes(normalizeName(requestedBook)) || normalizeName(requestedBook).includes(normalizeName(item.name)));
      if (!partial) return json({ error: `Kitab “${requestedBook}” tidak dikenali. Coba nama kitab lengkap, misalnya “1 Korintus”.` }, 400);
    }
    const chosen = book || books.find(item => normalizeName(item.name).includes(normalizeName(requestedBook)));
    if (chosen.chapter_count && chapter > chosen.chapter_count) return json({ error: `${chosen.name} hanya memiliki ${chosen.chapter_count} pasal.` }, 400);

    const passageResponse = await fetch(`${BASE_URL}/passage/${encodeURIComponent(chosen.abbr || chosen.name)}/${chapter}`, { headers });
    const passagePayload = await passageResponse.json().catch(() => ({}));
    if (!passageResponse.ok) return json({ error: passagePayload.message || passagePayload.error || `Gagal mengambil pasal (HTTP ${passageResponse.status}).` }, passageResponse.status === 404 ? 404 : 502);
    const passage = passagePayload.data || passagePayload;
    let verses = Array.isArray(passage.verses) ? passage.verses : [];
    if (start !== null) verses = verses.filter(v => Number(v.verse_number) >= start && Number(v.verse_number) <= end);
    if (start !== null && verses.length === 0) return json({ error: `Ayat ${start}${end !== start ? `-${end}` : ''} tidak ditemukan di ${chosen.name} pasal ${chapter}.` }, 404);
    return json({ data: { ...passage, book: passage.book || { name: chosen.name, abbr: chosen.abbr }, chapter: passage.chapter || chapter, verses } });
  } catch (error) {
    return json({ error: 'Tidak dapat terhubung ke API Indonesia. Periksa koneksi dan coba lagi.', detail: process.env.CONTEXT === 'dev' ? String(error) : undefined }, 502);
  }
};
