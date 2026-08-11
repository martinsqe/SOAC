const router          = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const ctrl            = require('../controllers/clubsFeed.controller');

/* GET /api/clubs-feed  — authenticated student */
router.get('/', verifyToken, ctrl.getFeed);

module.exports = router;
