const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const { uploadReportPhoto } = require('../config/multer');
const { uploadMvpPhoto } = require('../config/multer');
const {
  getEventReport, listReports, generateReport,
  uploadReportPhotos, replaceReportPhoto, updateMvpPhoto, updateMatchMvpPhoto,
  submitReport, getSubmittedReports, getAnnualReport, getReportYears,
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

/* Upload / replace tournament MVP photo */
router.patch('/events/:eventId/mvp-photo', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMvpPhoto,
);

/* Upload / replace a specific game MVP's player photo */
router.patch('/events/:eventId/match-mvps/:scoreId/photo', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMatchMvpPhoto,
);

/* Coordinator submits a report to admin */
router.post('/events/:eventId/submit', verifyToken, submitReport);

/* Admin: list all submitted reports */
router.get('/submitted', verifyToken, getSubmittedReports);

module.exports = router;
