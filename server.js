const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend')));

// Routes Configuration
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

// Apply routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Fallback to React app for non-API routes (if using React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`🔌 Database driver set to Supabase.`);
});
