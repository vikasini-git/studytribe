'use strict';
const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'studygroup.db');
let _db = null;

function persist() {
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

async function init() {
  const SQL = await initSqlJs();
  _db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  _db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Students (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      password     TEXT NOT NULL,
      roll_number  TEXT,
      department   TEXT,
      year         INTEGER,
      bio          TEXT DEFAULT '',
      mode         TEXT DEFAULT 'online',
      avatar_color TEXT DEFAULT '#328CC1',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS SkillTags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL REFERENCES Students(id) ON DELETE CASCADE,
      subject    TEXT NOT NULL,
      level      TEXT NOT NULL CHECK(level IN ('strong','weak'))
    );

    CREATE TABLE IF NOT EXISTS Subjects (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS Groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      subject     TEXT NOT NULL,
      description TEXT DEFAULT '',
      mode        TEXT DEFAULT 'online',
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS GroupMembers (
      group_id   TEXT NOT NULL REFERENCES Groups(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES Students(id) ON DELETE CASCADE,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS Messages (
      id         TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL REFERENCES Groups(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES Students(id),
      user_name  TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Notes (
      id         TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL REFERENCES Groups(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES Students(id),
      user_name  TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      file_name  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Schedules (
      id          TEXT PRIMARY KEY,
      group_id    TEXT NOT NULL REFERENCES Groups(id) ON DELETE CASCADE,
      student_id  TEXT NOT NULL REFERENCES Students(id),
      title       TEXT NOT NULL,
      date        TEXT NOT NULL,
      time        TEXT NOT NULL,
      duration    INTEGER DEFAULT 60,
      mode        TEXT DEFAULT 'online',
      reminder    INTEGER DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Milestones (
      id          TEXT PRIMARY KEY,
      group_id    TEXT NOT NULL REFERENCES Groups(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date    TEXT,
      completed   INTEGER DEFAULT 0,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed groups if empty
  const [[{ values: [[n]] }]] = [_db.exec(`SELECT COUNT(*) FROM Groups`)];
  if (n === 0) {
    const seeds = [
      ['g-001','Algorithms Core','Computer Science','Deep dive into sorting, graphs, and dynamic programming.','online'],
      ['g-002','Embedded Circuits','Electrical Engineering','Logic gates, microcontrollers, and circuit analysis.','offline'],
      ['g-003','Calculus II Study Hall','Mathematics','Integrals, series, and multivariable calculus.','online'],
      ['g-004','Data Structures Lab','Computer Science','Trees, heaps, hash maps — with code.','online'],
      ['g-005','Physics Mechanics','Applied Physics',"Newton's laws, kinematics, rotational dynamics.",'offline'],
      ['g-006','DBMS & SQL','Computer Science','Relational models, normalization, query optimization.','online'],
      ['g-007','Thermodynamics','Mechanical Engineering','Heat transfer, entropy, and thermodynamic cycles.','online'],
    ];
    const s = _db.prepare(`INSERT OR IGNORE INTO Groups(id,name,subject,description,mode,created_by) VALUES(?,?,?,?,?,'system')`);
    seeds.forEach(r => s.run(r));
    s.free();

    const subjs = ['Computer Science','Mathematics','Physics','Electrical Engineering','Mechanical Engineering','Chemistry','Data Science','Economics'];
    const ss = _db.prepare(`INSERT OR IGNORE INTO Subjects(name) VALUES(?)`);
    subjs.forEach(s2 => ss.run([s2]));
    ss.free();
    persist();
  }

  console.log('[DB] SQLite ready →', DB_FILE);
  return _db;
}

// ─── helpers ────────────────────────────────────────────────────────────────
function query(sql, p = []) {
  const r = _db.exec(sql, p);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => { const o = {}; columns.forEach((c,i) => o[c]=row[i]); return o; });
}
function run(sql, p = []) { _db.run(sql, p); persist(); }
function get(sql, p = [])  { return query(sql, p)[0] ?? null; }

// ─── Students ───────────────────────────────────────────────────────────────
function createStudent({ id, name, email, password, roll_number, department, year }) {
  const colors = ['#328CC1','#7c3aed','#059669','#d97706','#dc2626','#0891b2'];
  const color = colors[Math.floor(Math.random()*colors.length)];
  run(`INSERT INTO Students(id,name,email,password,roll_number,department,year,avatar_color)
       VALUES(?,?,?,?,?,?,?,?)`,
    [id,name,email,password,roll_number??null,department??null,year??null,color]);
  return getStudentById(id);
}
function getStudentByEmail(e) { return get(`SELECT * FROM Students WHERE email=?`,[e]); }
function getStudentById(id)   { return get(`SELECT id,name,email,roll_number,department,year,bio,mode,avatar_color,created_at FROM Students WHERE id=?`,[id]); }
function updateStudent(id, { name, bio, mode, department, year, roll_number }) {
  run(`UPDATE Students SET name=COALESCE(?,name), bio=COALESCE(?,bio), mode=COALESCE(?,mode),
       department=COALESCE(?,department), year=COALESCE(?,year), roll_number=COALESCE(?,roll_number)
       WHERE id=?`,
    [name??null, bio??null, mode??null, department??null, year??null, roll_number??null, id]);
  return getStudentById(id);
}

// ─── SkillTags ───────────────────────────────────────────────────────────────
function setSkillTags(studentId, tags) {
  // tags = [{ subject, level }]
  run(`DELETE FROM SkillTags WHERE student_id=?`,[studentId]);
  const s = _db.prepare(`INSERT INTO SkillTags(student_id,subject,level) VALUES(?,?,?)`);
  tags.forEach(t => s.run([studentId, t.subject, t.level]));
  s.free();
  persist();
}
function getSkillTags(studentId) {
  return query(`SELECT subject, level FROM SkillTags WHERE student_id=?`,[studentId]);
}
function getAllStudentsWithSkills() {
  const students = query(`SELECT id,name,department,year,mode,bio,avatar_color FROM Students WHERE id != 'system'`);
  return students.map(st => ({
    ...st,
    skills: getSkillTags(st.id)
  }));
}

// ─── Subjects ───────────────────────────────────────────────────────────────
function getSubjects() { return query(`SELECT name FROM Subjects ORDER BY name`).map(r=>r.name); }

// ─── Groups ─────────────────────────────────────────────────────────────────
function getAllGroups(studentId) {
  return query(`
    SELECT g.*, COUNT(DISTINCT gm.student_id) AS member_count,
      CASE WHEN me.student_id IS NOT NULL THEN 1 ELSE 0 END AS is_member
    FROM Groups g
    LEFT JOIN GroupMembers gm ON gm.group_id=g.id
    LEFT JOIN GroupMembers me ON me.group_id=g.id AND me.student_id=?
    GROUP BY g.id ORDER BY g.created_at DESC`, [studentId]);
}
function getGroupsForStudent(studentId) {
  return query(`
    SELECT g.*, COUNT(DISTINCT gm.student_id) AS member_count, 1 AS is_member
    FROM Groups g
    JOIN GroupMembers gm ON gm.group_id=g.id
    JOIN GroupMembers me ON me.group_id=g.id AND me.student_id=?
    GROUP BY g.id ORDER BY g.created_at DESC`, [studentId]);
}
function getGroupById(id) { return get(`SELECT * FROM Groups WHERE id=?`,[id]); }
function createGroup({ id, name, subject, description, mode, created_by }) {
  run(`INSERT INTO Groups(id,name,subject,description,mode,created_by) VALUES(?,?,?,?,?,?)`,
    [id,name,subject,description??'',mode??'online',created_by]);
  joinGroup(id, created_by);
  return getGroupById(id);
}
function joinGroup(groupId, studentId) {
  run(`INSERT OR IGNORE INTO GroupMembers(group_id,student_id) VALUES(?,?)`,[groupId,studentId]);
}
function leaveGroup(groupId, studentId) {
  run(`DELETE FROM GroupMembers WHERE group_id=? AND student_id=?`,[groupId,studentId]);
}
function isMember(groupId, studentId) {
  return !!get(`SELECT 1 FROM GroupMembers WHERE group_id=? AND student_id=?`,[groupId,studentId]);
}
function getMemberCount(groupId) { return get(`SELECT COUNT(*) AS c FROM GroupMembers WHERE group_id=?`,[groupId])?.c??0; }
function getGroupMembers(groupId) {
  return query(`SELECT s.id,s.name,s.department,s.year,s.mode,s.avatar_color FROM Students s
    JOIN GroupMembers gm ON gm.student_id=s.id WHERE gm.group_id=? ORDER BY gm.joined_at`,[groupId]);
}

// ─── Messages ────────────────────────────────────────────────────────────────
function saveMessage({ id, group_id, student_id, user_name, text }) {
  run(`INSERT INTO Messages(id,group_id,student_id,user_name,text) VALUES(?,?,?,?,?)`,[id,group_id,student_id,user_name,text]);
  return get(`SELECT * FROM Messages WHERE id=?`,[id]);
}
function getMessages(groupId, limit=100) {
  return query(`SELECT * FROM Messages WHERE group_id=? ORDER BY created_at ASC LIMIT ?`,[groupId,limit]);
}

// ─── Notes ───────────────────────────────────────────────────────────────────
function saveNote({ id, group_id, student_id, user_name, title, content, file_name }) {
  run(`INSERT INTO Notes(id,group_id,student_id,user_name,title,content,file_name) VALUES(?,?,?,?,?,?,?)`,
    [id,group_id,student_id,user_name,title,content,file_name??null]);
  return get(`SELECT * FROM Notes WHERE id=?`,[id]);
}
function getNotes(groupId) {
  return query(`SELECT * FROM Notes WHERE group_id=? ORDER BY created_at DESC`,[groupId]);
}
function deleteNote(id, studentId) {
  run(`DELETE FROM Notes WHERE id=? AND student_id=?`,[id,studentId]);
}

// ─── Schedules ───────────────────────────────────────────────────────────────
function saveSchedule({ id, group_id, student_id, title, date, time, duration, mode }) {
  run(`INSERT INTO Schedules(id,group_id,student_id,title,date,time,duration,mode) VALUES(?,?,?,?,?,?,?,?)`,
    [id,group_id,student_id,title,date,time,duration??60,mode??'online']);
  return get(`SELECT * FROM Schedules WHERE id=?`,[id]);
}
function getSchedules(studentId) {
  return query(`SELECT sc.*, g.name AS group_name, g.subject
    FROM Schedules sc JOIN Groups g ON g.id=sc.group_id
    WHERE sc.student_id=? OR sc.group_id IN (
      SELECT group_id FROM GroupMembers WHERE student_id=?)
    ORDER BY sc.date ASC, sc.time ASC`,[studentId,studentId]);
}
function getGroupSchedules(groupId) {
  return query(`SELECT * FROM Schedules WHERE group_id=? ORDER BY date ASC, time ASC`,[groupId]);
}
function deleteSchedule(id, studentId) {
  run(`DELETE FROM Schedules WHERE id=? AND student_id=?`,[id,studentId]);
}

// ─── Milestones ──────────────────────────────────────────────────────────────
function saveMilestone({ id, group_id, title, description, due_date, created_by }) {
  run(`INSERT INTO Milestones(id,group_id,title,description,due_date,created_by) VALUES(?,?,?,?,?,?)`,
    [id,group_id,title,description??'',due_date??null,created_by]);
  return get(`SELECT * FROM Milestones WHERE id=?`,[id]);
}
function getMilestones(groupId) {
  return query(`SELECT * FROM Milestones WHERE group_id=? ORDER BY due_date ASC, created_at ASC`,[groupId]);
}
function toggleMilestone(id) {
  run(`UPDATE Milestones SET completed=CASE WHEN completed=1 THEN 0 ELSE 1 END WHERE id=?`,[id]);
  return get(`SELECT * FROM Milestones WHERE id=?`,[id]);
}
function deleteMilestone(id) {
  run(`DELETE FROM Milestones WHERE id=?`,[id]);
}

module.exports = {
  init,
  createStudent, getStudentByEmail, getStudentById, updateStudent,
  setSkillTags, getSkillTags, getAllStudentsWithSkills,
  getSubjects,
  getAllGroups, getGroupsForStudent, getGroupById, createGroup,
  joinGroup, leaveGroup, isMember, getMemberCount, getGroupMembers,
  saveMessage, getMessages,
  saveNote, getNotes, deleteNote,
  saveSchedule, getSchedules, getGroupSchedules, deleteSchedule,
  saveMilestone, getMilestones, toggleMilestone, deleteMilestone,
};
