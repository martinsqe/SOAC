/* Admin side of Galore's Student of the Year — see services/galoreSoty.js */
const soty = require('../services/galoreSoty');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof soty.SotyError) return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/* GET /api/events/:id/soty — the contest (published or not) and every contestant */
const get = handle(async (req, res) => {
  res.json(await soty.listEntries(req.params.id));
});

/* PUT /api/events/:id/soty { title, academicYear, published } */
const save = handle(async (req, res) => {
  res.json({ contest: await soty.saveContest(req.params.id, req.body) });
});

/* PUT /api/events/:id/soty/dates { opensOn, deadline } — when entries are taken */
const saveDates = handle(async (req, res) => {
  res.json({ contest: await soty.setDates(req.params.id, req.body || {}) });
});

/* PUT /api/events/:id/soty/deadline { deadline: 'YYYY-MM-DD' | '' } */
const saveDeadline = handle(async (req, res) => {
  res.json({ contest: await soty.setDeadline(req.params.id, req.body?.deadline) });
});

/* DELETE /api/events/:id/soty/entries/:entryId */
const removeEntry = handle(async (req, res) => {
  await soty.deleteEntry(req.params.id, req.params.entryId);
  res.json({ message: 'Contestant removed.' });
});

module.exports = { get, save, saveDates, saveDeadline, removeEntry };
