const router = require('express').Router();
const ctrl = require('../controllers/push.controller');
const { verifyToken } = require('../middleware/auth');

router.post('/subscribe',   verifyToken, ctrl.subscribe);
router.delete('/subscribe', verifyToken, ctrl.unsubscribe);

module.exports = router;
