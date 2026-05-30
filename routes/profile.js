'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const router  = express.Router();
const SECRET  = process.env.JWT_SECRET || 'studytribe_secret';

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error:'Auth required.' });
  try { req.user = jwt.verify(h.slice(7), SECRET); next(); }
  catch { res.status(401).json({ error:'Invalid token.' }); }
}
router.use(auth);

// GET /api/profile
router.get('/', (req, res) => {
  const student = db.getStudentById(req.user.id);
  const skills  = db.getSkillTags(req.user.id);
  res.json({ ...student, skills });
});

// PUT /api/profile
router.put('/', (req, res) => {
  const updated = db.updateStudent(req.user.id, req.body);
  res.json(updated);
});

// PUT /api/profile/skills
router.put('/skills', (req, res) => {
  const { skills } = req.body;  // [{ subject, level }]
  if (!Array.isArray(skills)) return res.status(400).json({ error:'skills must be an array.' });
  db.setSkillTags(req.user.id, skills);
  res.json({ skills: db.getSkillTags(req.user.id) });
});

// GET /api/profile/schedules
router.get('/schedules', (req, res) => {
  res.json(db.getSchedules(req.user.id));
});

// DELETE /api/profile/schedules/:id
router.delete('/schedules/:id', (req, res) => {
  db.deleteSchedule(req.params.id, req.user.id);
  res.json({ success:true });
});

// GET /api/profile/subjects
router.get('/subjects', (_req, res) => res.json(db.getSubjects()));

// GET /api/profile/ai-matches  — Rule-based skill-gap compatibility matcher
router.get('/ai-matches', (req, res) => {
  const mySkills = db.getSkillTags(req.user.id);
  const me       = db.getStudentById(req.user.id);
  const everyone = db.getAllStudentsWithSkills().filter(s => s.id !== req.user.id);

  if (mySkills.length === 0) {
    return res.json({ matches:[], message:'Add your skill tags in Profile to get AI matches.' });
  }

  const myStrong = new Set(mySkills.filter(s=>s.level==='strong').map(s=>s.subject));
  const myWeak   = new Set(mySkills.filter(s=>s.level==='weak').map(s=>s.subject));

  const scored = everyone.map(student => {
    const theirStrong = new Set(student.skills.filter(s=>s.level==='strong').map(s=>s.subject));
    const theirWeak   = new Set(student.skills.filter(s=>s.level==='weak').map(s=>s.subject));

    let score = 0;
    const reasons = [];

    // +3 if they're strong where I'm weak
    myWeak.forEach(sub => {
      if (theirStrong.has(sub)) { score += 3; reasons.push(`Strong in ${sub} (you need help)`); }
    });
    // +3 if I'm strong where they're weak
    theirWeak.forEach(sub => {
      if (myStrong.has(sub)) { score += 3; reasons.push(`You can help them with ${sub}`); }
    });
    // +1 for each shared strong subject (same interest)
    myStrong.forEach(sub => {
      if (theirStrong.has(sub)) { score += 1; reasons.push(`Shared interest in ${sub}`); }
    });
    // +1 same department
    if (me?.department && student.department === me.department) { score += 1; reasons.push('Same department'); }
    // +1 same year
    if (me?.year && student.year === me.year) { score += 1; reasons.push('Same year'); }

    const pct = Math.min(100, Math.round((score / Math.max(1, myWeak.size*3 + myStrong.size*2)) * 100));

    return { student, score, pct, reasons: reasons.slice(0,4) };
  });

  const matches = scored
    .filter(m => m.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 8);

  res.json({ matches });
});

module.exports = router;
