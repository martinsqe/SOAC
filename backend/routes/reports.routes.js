const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const { uploadReportPhoto } = require('../config/multer');
const { uploadMvpPhoto } = require('../config/multer');
const {
  getEventReport, listReports, generateReport,
  uploadReportPhotos, replaceReportPhoto, updateMvpPhoto, getAnnualReport, getReportYears,
} = require('../controllers/reports.controller');

/* List all reports for a club */
router.get('/', verifyToken, listReports);

/* Available academic years */
router.get('/years', verifyToken, getReportYears);

/* Annual aggregate report */
router.get('/annual', verifyToken, getAnnualReport);

/* Single event report */
router.get('/events/:eventId', verifyToken, getEventReport);

/* Generate / regenerate report for an event */
router.post('/events/:eventId/generate', verifyToken, generateReport);

/* Upload photos for a report (max 5 at a time) */
router.patch('/events/:eventId/photos', verifyToken,
  uploadReportPhoto.array('photos', 5),
  uploadReportPhotos,
);

/* Replace a single photo at a specific slot index */
router.patch('/events/:eventId/photos/:index', verifyToken,
  uploadReportPhoto.single('photo'),
  replaceReportPhoto,
);

/* Upload / replace MVP photo */
router.patch('/events/:eventId/mvp-photo', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMvpPhoto,
);

module.exports = router;
