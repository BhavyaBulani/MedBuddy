const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase'); // The Supabase client

const JWT_SECRET = process.env.JWT_SECRET || 'secret-medbuddy-key';

// User generation can rely on DB default UUID generation

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('Users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    let { data: user, error } = await supabase
      .from('Users')
      .insert([{ name, email, password, phone }])
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({ 
      token, 
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone } 
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: 'Server error during signup. ' + (error.message || '') });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('Users')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single();
    
    // Supabase returns an error for .single() if 0 or >1 items found
    if (error || !user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone } 
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: 'Server error during login. ' + (error.message || '') });
  }
});

module.exports = router;
