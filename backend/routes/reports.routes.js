const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const { uploadReportPhoto, uploadLogo } = require('../config/multer');
const { uploadMvpPhoto } = require('../config/multer');
const {
  getEventReport, listReports, generateReport, deleteReport,
  uploadReportPhotos, replaceReportPhoto, uploadHighlightPhotos, replaceHighlightPhoto,
  updateMvpPhoto, updateMvpSidePhoto, updateMatchMvpPhoto,
  updateNarrative, submitReport, getSubmittedReports, getAnnualReport, getReportYears,
  uploadReportLogos, removeReportLogo, uploadReportBanner, removeReportBanner, removeReportPhoto, downloadReportDocx,
} = require('../controllers/reports.controller');

/* List all reports for a club */
router.get('/', verifyToken, listReports);

/* Available academic years */
router.get('/years', verifyToken, getReportYears);

/* Annual aggregate report */
router.get('/annual', verifyToken, getAnnualReport);

/* Single event report */
router.get('/events/:eventId', verifyToken, getEventReport);

/* Download the report as a Word (.docx) file */
router.get('/events/:eventId/download/docx', verifyToken, downloadReportDocx);

/* Generate / regenerate report for an event */
router.post('/events/:eventId/generate', verifyToken, generateReport);

/* Delete a report (only before submission) */
router.delete('/events/:eventId', verifyToken, deleteReport);

/* Collaboration logos for the letterhead — same upload pipeline as club logos */
router.patch('/events/:eventId/logos', verifyToken, uploadLogo.array('logos', 4), uploadReportLogos);
router.delete('/events/:eventId/logos/:index', verifyToken, removeReportLogo);

/* Optional event banner / brochure */
router.patch('/events/:eventId/banner', verifyToken, uploadReportPhoto.single('banner'), uploadReportBanner);
router.delete('/events/:eventId/banner', verifyToken, removeReportBanner);

/* Upload event photos (up to 6 in total, 2 per row in the report) */
router.patch('/events/:eventId/photos', verifyToken,
  uploadReportPhoto.array('photos', 6),
  uploadReportPhotos,
);

/* Remove one event photo */
router.delete('/events/:eventId/photos/:index', verifyToken, removeReportPhoto);

/* Replace a single photo at a specific slot index */
router.patch('/events/:eventId/photos/:index', verifyToken,
  uploadReportPhoto.single('photo'),
  replaceReportPhoto,
);

/* Upload photos for the second strip shown under Key Highlights (max 4 at a time) */
router.patch('/events/:eventId/highlight-photos', verifyToken,
  uploadReportPhoto.array('photos', 4),
  uploadHighlightPhotos,
);

/* Replace a single highlight photo at a specific slot index */
router.patch('/events/:eventId/highlight-photos/:index', verifyToken,
  uploadReportPhoto.single('photo'),
  replaceHighlightPhoto,
);

/* Upload / replace tournament MVP photo */
router.patch('/events/:eventId/mvp-photo', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMvpPhoto,
);

/* Upload / replace tournament MVP flanking side photo (left or right) */
router.patch('/events/:eventId/mvp-side-photo/:side', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMvpSidePhoto,
);

/* Upload / replace a specific game MVP's player photo */
router.patch('/events/:eventId/match-mvps/:scoreId/photo', verifyToken,
  uploadMvpPhoto.single('photo'),
  updateMatchMvpPhoto,
);

/* Save coordinator-written narrative sections */
router.patch('/events/:eventId/narrative', verifyToken, updateNarrative);

/* Coordinator submits a report to admin */
router.post('/events/:eventId/submit', verifyToken, submitReport);

/* Admin: list all submitted reports */
router.get('/submitted', verifyToken, getSubmittedReports);

module.exports = router;
