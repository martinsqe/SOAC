const router          = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const ctrl            = require('../controllers/clubsFeed.controller');

/* GET /api/clubs-feed  — authenticated student */
router.get('/', verifyToken, ctrl.getFeed);

/* POST /api/clubs-feed/watch  — record watch-time engagement for a topic */
router.post('/watch', verifyToken, ctrl.recordWatch);

module.exports = router;
