'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db      = require('../db');
const router  = express.Router();
const SECRET  = process.env.JWT_SECRET || 'studytribe_secret';

function sign(u) { return jwt.sign({ id:u.id, name:u.name, email:u.email }, SECRET, { expiresIn:'7d' }); }

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, roll_number, department, year } = req.body;
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error:'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error:'Password must be at least 6 characters.' });
    const norm = email.toLowerCase().trim();
    if (db.getStudentByEmail(norm))
      return res.status(409).json({ error:'This email is already registered.' });
    const hash = await bcrypt.hash(password, 12);
    const student = db.createStudent({ id:uuid(), name:name.trim(), email:norm, password:hash,
      roll_number:roll_number?.trim()||null, department:department?.trim()||null,
      year:year?parseInt(year):null });
    res.status(201).json({ token:sign(student), user:student });
  } catch(e) { console.error(e); res.status(500).json({ error:'Registration failed.' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email?.trim() || !password)
      return res.status(400).json({ error:'Email and password are required.' });
    const student = db.getStudentByEmail(email.toLowerCase().trim());
    const dummy = '$2a$12$dummyhashfortiming0000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, student?.password ?? dummy);
    if (!student || !ok) return res.status(401).json({ error:'Invalid email or password.' });
    res.json({ token:sign(student), user:db.getStudentById(student.id) });
  } catch(e) { console.error(e); res.status(500).json({ error:'Login failed.' }); }
});

router.get('/me', (req, res) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return res.status(401).json({ error:'No token.' });
    const d = jwt.verify(h.slice(7), SECRET);
    const s = db.getStudentById(d.id);
    if (!s) return res.status(404).json({ error:'User not found.' });
    res.json({ user:s });
  } catch { res.status(401).json({ error:'Invalid token.' }); }
});

module.exports = router;
