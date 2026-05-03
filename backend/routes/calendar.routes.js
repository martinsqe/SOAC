const router = require('express').Router();
const ctrl   = require('../controllers/calendar.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

router.get('/',    ctrl.getCalendar);                            // public read
router.post('/',   verifyToken, requireAdmin, ctrl.createEvent);
router.put('/:id', verifyToken, requireAdmin, ctrl.updateEvent);
router.delete('/:id', verifyToken, requireAdmin, ctrl.deleteEvent);

module.exports = router;
