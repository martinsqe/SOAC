const router          = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const ctrl            = require('../controllers/newsFeed.controller');

/* GET /api/news-feed  — authenticated (any role; content is club-scoped) */
router.get('/', verifyToken, ctrl.getFeed);

module.exports = router;
