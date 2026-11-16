/* Admin side of the Galore gallery — see services/galoreGallery.js */
const gallery = require('../services/galoreGallery');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof gallery.GalleryError) return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

const list      = handle(async (req, res) => res.json({ posts: await gallery.list(req.params.id) }));
const signature = handle(async (req, res) => res.json(gallery.signature(req.body?.kind)));
const create    = handle(async (req, res) => {
  res.status(201).json({ post: await gallery.create(req.params.id, req.body, req.file, { name: req.user.name || 'SOAC admin', role: 'admin' }) });
});
const remove    = handle(async (req, res) => {
  await gallery.remove(req.params.id, req.params.postId);
  res.json({ message: 'Removed.' });
});

module.exports = { list, signature, create, remove };
