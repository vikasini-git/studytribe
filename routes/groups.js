'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
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

router.get('/',       (req,res) => res.json(db.getAllGroups(req.user.id)));
router.get('/mine',   (req,res) => res.json(db.getGroupsForStudent(req.user.id)));

router.post('/', (req, res) => {
  const { name, subject, description, mode } = req.body;
  if (!name?.trim() || !subject?.trim())
    return res.status(400).json({ error:'Name and subject required.' });
  const g = db.createGroup({ id:uuid(), name:name.trim(), subject:subject.trim(),
    description:description?.trim()||'', mode:mode||'online', created_by:req.user.id });
  res.status(201).json({ ...g, member_count:1, is_member:1 });
});

router.get('/:id', (req, res) => {
  const g = db.getGroupById(req.params.id);
  if (!g) return res.status(404).json({ error:'Group not found.' });
  res.json({ ...g, member_count:db.getMemberCount(req.params.id),
    is_member: db.isMember(req.params.id, req.user.id)?1:0,
    members: db.getGroupMembers(req.params.id) });
});

router.post('/:id/join', (req, res) => {
  const g = db.getGroupById(req.params.id);
  if (!g) return res.status(404).json({ error:'Group not found.' });
  db.joinGroup(req.params.id, req.user.id);
  res.json({ ...g, member_count:db.getMemberCount(req.params.id), is_member:1 });
});

router.post('/:id/leave', (req, res) => {
  const g = db.getGroupById(req.params.id);
  if (!g) return res.status(404).json({ error:'Group not found.' });
  db.leaveGroup(req.params.id, req.user.id);
  res.json({ ...g, member_count:db.getMemberCount(req.params.id), is_member:0 });
});

// Messages
router.get('/:id/messages', (req, res) => {
  if (!db.getGroupById(req.params.id)) return res.status(404).json({ error:'Group not found.' });
  res.json(db.getMessages(req.params.id, Math.min(parseInt(req.query.limit)||100,500)));
});

// Notes
router.get('/:id/notes', (req, res) => res.json(db.getNotes(req.params.id)));
router.post('/:id/notes', (req, res) => {
  const { title, content, file_name } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error:'Title and content required.' });
  const note = db.saveNote({ id:uuid(), group_id:req.params.id, student_id:req.user.id,
    user_name:req.user.name, title:title.trim(), content:content.trim(), file_name:file_name||null });
  res.status(201).json(note);
});
router.delete('/:id/notes/:noteId', (req, res) => {
  db.deleteNote(req.params.noteId, req.user.id);
  res.json({ success:true });
});

// Schedules
router.get('/:id/schedules', (req, res) => res.json(db.getGroupSchedules(req.params.id)));
router.post('/:id/schedules', (req, res) => {
  const { title, date, time, duration, mode } = req.body;
  if (!title?.trim() || !date || !time) return res.status(400).json({ error:'Title, date, time required.' });
  const s = db.saveSchedule({ id:uuid(), group_id:req.params.id, student_id:req.user.id,
    title:title.trim(), date, time, duration:parseInt(duration)||60, mode:mode||'online' });
  res.status(201).json(s);
});

// Milestones
router.get('/:id/milestones', (req, res) => res.json(db.getMilestones(req.params.id)));
router.post('/:id/milestones', (req, res) => {
  const { title, description, due_date } = req.body;
  if (!title?.trim()) return res.status(400).json({ error:'Title required.' });
  const m = db.saveMilestone({ id:uuid(), group_id:req.params.id, title:title.trim(),
    description:description||'', due_date:due_date||null, created_by:req.user.id });
  res.status(201).json(m);
});
router.patch('/:id/milestones/:mid/toggle', (req, res) => res.json(db.toggleMilestone(req.params.mid)));
router.delete('/:id/milestones/:mid', (req, res) => { db.deleteMilestone(req.params.mid); res.json({ success:true }); });

module.exports = router;
