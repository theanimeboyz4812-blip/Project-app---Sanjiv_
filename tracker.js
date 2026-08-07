/* =================================================================
   TRACKER API ROUTES
   ------------------------------------------------------------------
   POST /api/tracker   →  the ESP32 sends a new GPS reading here
   GET  /api/tracker    →  the website asks for the latest reading here

   This keeps only the MOST RECENT reading in memory (it resets if
   the server restarts). That's perfectly fine for a live "where is
   it right now" tracker. If you later want a full trip history,
   you'd swap this out for a real database (like MongoDB or Firebase)
   and save every reading instead of overwriting the last one.
   ================================================================= */

const express = require('express');
const router  = express.Router();

// The single most recent reading, kept in the server's memory
let latestReading = {
  latitude:   null,
  longitude:  null,
  isBreached: false,
  timestamp:  null
};

// --- ESP32 (or a test tool like Postman/curl) sends new data here ---
router.post('/', (req, res) => {
  const { latitude, longitude, isBreached, timestamp } = req.body;

  // basic validation so a bad request doesn't silently corrupt our data
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'latitude and longitude are required' });
  }

  latestReading = {
    latitude,
    longitude,
    isBreached: Boolean(isBreached),
    timestamp: timestamp || Date.now() // falls back to server time if the device didn't send one
  };

  console.log('New reading received:', latestReading);

  // Push this update out to every connected browser tab immediately
  const io = req.app.get('io');
  io.emit('trackerUpdate', latestReading);

  res.status(200).json({ message: 'Reading saved', data: latestReading });
});

// --- Website asks for the latest reading here ---
router.get('/', (req, res) => {
  res.status(200).json(latestReading);
});

module.exports = router;
