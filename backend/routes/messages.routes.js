const router          = require('express').Router();
const ctrl            = require('../controllers/messages.controller');
const { verifyToken } = require('../middleware/auth');
const msgRateLimit    = require('../middleware/msgRateLimit');

router.get('/conversations', verifyToken, ctrl.getConversations);
router.get('/members',       verifyToken, ctrl.getClubMembers);
router.get('/dm/:userId',    verifyToken, ctrl.getDMs);
router.post('/dm/:userId',   verifyToken, msgRateLimit(), ctrl.sendDM);

module.exports = router;
