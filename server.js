/* =================================================================
   SMART TRANSIT GUARD — Backend Server
   ------------------------------------------------------------------
   What this file does:
   1. Starts a small web server (Express) that the ESP32 hardware
      can send GPS + breach data to.
   2. Opens a WebSocket connection (Socket.io) so the website can
      receive that data the INSTANT it arrives — no refreshing,
      no polling, no waiting.
   3. Wires everything together — the actual "save this reading" /
      "get the latest reading" logic lives in routes/tracker.js
      to keep this file short and easy to read.

   ------------------------------------------------------------------
   HOW TO RUN THIS:
     1. Open a terminal inside this "backend" folder
     2. Run:  npm install
     3. Run:  npm start
     4. You should see: "Smart Transit Guard backend running on
        http://localhost:3000"
   ================================================================= */

const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const trackerRoutes = require('./routes/tracker');

const app = express();

app.use(cors());          // lets the website (a different origin/port) talk to this server
app.use(express.json());  // lets us read JSON data sent by the ESP32

// Wrap the Express app in a plain HTTP server so Socket.io can attach to it
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // fine for a school project demo; tighten this if it ever goes public
});

// Make the "io" object available inside routes/tracker.js so it can
// broadcast new readings out to every connected browser tab
app.set('io', io);

// Every request to /api/tracker/... is handled in routes/tracker.js
app.use('/api/tracker', trackerRoutes);

// A simple homepage — just confirms the server is alive if you visit it directly
app.get('/', (req, res) => {
  res.send('Smart Transit Guard backend is running. Try GET /api/tracker for the latest reading.');
});

// Logs when a browser tab connects/disconnects — handy for debugging during your demo
io.on('connection', (socket) => {
  console.log('Browser connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Browser disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Smart Transit Guard backend running on http://localhost:${PORT}`);
});
