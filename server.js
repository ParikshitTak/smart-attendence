import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import crypto from 'crypto';
import db from './db.js';

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const ESP32_KEY = process.env.ESP32_KEY || 'esp32-shared-secret';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                       */
/* ------------------------------------------------------------------ */
function setSession(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
}
function readSession(req) {
  const t = req.cookies.session;
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}
function requireTeacher(req, res, next) {
  const s = readSession(req);
  if (!s || s.role !== 'teacher') return res.status(401).json({ error: 'Teacher login required' });
  req.teacher = s; next();
}
function requireStudent(req, res, next) {
  const s = readSession(req);
  if (!s || s.role !== 'student') return res.status(401).json({ error: 'Student login required' });
  req.student = s; next();
}

/* ------------------------------------------------------------------ */
/*  Auth routes                                                        */
/* ------------------------------------------------------------------ */
app.post('/api/login', (req, res) => {
  const { role, name, rollno, password } = req.body;
  if (role === 'teacher') {
    const row = db.prepare('SELECT * FROM teachers WHERE name = ?').get(name || '');
    if (!row || !bcrypt.compareSync(password || '', row.password))
      return res.status(401).json({ error: 'Invalid teacher credentials' });
    setSession(res, { role: 'teacher', id: row.id, name: row.name });
    return res.json({ ok: true });
  }
  if (role === 'student') {
    const row = db.prepare('SELECT * FROM students WHERE rollno = ?').get((rollno || '').toUpperCase());
    if (!row || !bcrypt.compareSync(password || '', row.password))
      return res.status(401).json({ error: 'Invalid student credentials' });
    setSession(res, { role: 'student', id: row.id, name: row.name, rollno: row.rollno, branch: row.branch });
    return res.json({ ok: true });
  }
  res.status(400).json({ error: 'Unknown role' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = readSession(req);
  res.json(s || { role: null });
});

/* ------------------------------------------------------------------ */
/*  Teacher: create & manage lectures                                  */
/* ------------------------------------------------------------------ */
app.post('/api/lectures', requireTeacher, (req, res) => {
  const { subject, branch, room, date, startTime, duration } = req.body;
  if (!subject || !branch || !room || !date || !startTime || !duration)
    return res.status(400).json({ error: 'All fields required' });

  const info = db.prepare(`
    INSERT INTO lectures (teacher_id, subject, branch, room, lecture_date, start_time, duration_min, status)
    VALUES (?,?,?,?,?,?,?, 'active')
  `).run(req.teacher.id, subject, branch.toUpperCase(), room, date, startTime, Number(duration));

  res.json({ ok: true, lectureId: info.lastInsertRowid });
});

app.get('/api/lectures', requireTeacher, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, 
      (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS present_count
    FROM lectures l
    WHERE l.teacher_id = ?
    ORDER BY l.id DESC
  `).all(req.teacher.id);
  res.json(rows);
});

app.post('/api/lectures/:id/stop', requireTeacher, (req, res) => {
  const id = Number(req.params.id);
  const lec = db.prepare('SELECT * FROM lectures WHERE id = ? AND teacher_id = ?')
    .get(id, req.teacher.id);
  if (!lec) return res.status(404).json({ error: 'Lecture not found' });
  db.prepare("UPDATE lectures SET status = 'stopped' WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get('/api/lectures/:id/attendance', requireTeacher, (req, res) => {
  const id = Number(req.params.id);
  const lec = db.prepare('SELECT * FROM lectures WHERE id = ? AND teacher_id = ?')
    .get(id, req.teacher.id);
  if (!lec) return res.status(404).json({ error: 'Lecture not found' });
  const rows = db.prepare(`
    SELECT student_rollno, student_name, scanned_at
    FROM attendance WHERE lecture_id = ?
    ORDER BY student_rollno ASC
  `).all(id);
  res.json({ lecture: lec, present: rows });
});

/* ------------------------------------------------------------------ */
/*  Student: list active lectures for their branch (WITH TIME CHECK)   */
/* ------------------------------------------------------------------ */
app.get('/api/student/lectures', requireStudent, (req, res) => {
  const now = new Date();
  
  const rows = db.prepare(`
    SELECT l.*, t.name AS teacher_name,
      (SELECT 1 FROM attendance a WHERE a.lecture_id = l.id AND a.student_rollno = ?) AS already_marked
    FROM lectures l
    JOIN teachers t ON t.id = l.teacher_id
    WHERE l.branch = ? AND l.status = 'active'
    ORDER BY l.id DESC
  `).all(req.student.rollno, req.student.branch);

  // Filter out lectures that haven't started yet (Strict Local Comparison)
  const activeLectures = rows.filter(l => {
    const lectureStart = new Date(`${l.lecture_date}T${l.start_time}:00`);
    return now.getTime() >= lectureStart.getTime(); 
  });

  res.json(activeLectures);
});

/* ------------------------------------------------------------------ */
/*  Student: generate a 10-second QR token (WITH TIME CHECK)           */
/* ------------------------------------------------------------------ */
app.get('/api/student/qr/:lectureId', requireStudent, (req, res) => {
  const lectureId = Number(req.params.lectureId);
  const lec = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
  
  if (!lec || lec.status !== 'active')
    return res.status(400).json({ error: 'Lecture not active' });
  if (lec.branch !== req.student.branch)
    return res.status(403).json({ error: 'Lecture is not for your branch' });

  // Time check: Has the lecture started? (Strict Local Comparison)
  const now = new Date();
  const lectureStart = new Date(`${lec.lecture_date}T${lec.start_time}:00`);
  
  if (now < lectureStart) {
    return res.status(403).json({ 
      error: `Lecture has not started yet. It is scheduled for ${lec.start_time}.` 
    });
  }

  const payload = {
    rollno: req.student.rollno,
    name:   req.student.name,
    lectureId,
    jti: crypto.randomUUID()
  };
  
  // Back to 10 seconds!
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '10s' });

  QRCode.toDataURL(token, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
    .then((dataUrl) => res.json({
      qr: dataUrl,
      token,
      expiresIn: 10, // Back to 10 seconds!
      rollno: req.student.rollno,
      name: req.student.name
    }))
    .catch((e) => res.status(500).json({ error: 'QR generation failed', detail: String(e) }));
});

/* ------------------------------------------------------------------ */
/*  ESP32-CAM: scan endpoint                                           */
/* ------------------------------------------------------------------ */
app.post('/api/scan', (req, res) => {
  const { key, token } = req.body || {};
  if (key !== ESP32_KEY) return res.status(401).json({ error: 'Bad device key' });
  if (!token) return res.status(400).json({ error: 'Missing token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(400).json({ error: 'QR expired or invalid', detail: e.message });
  }

  const lec = db.prepare('SELECT * FROM lectures WHERE id = ?').get(payload.lectureId);
  if (!lec) return res.status(404).json({ error: 'Lecture not found' });
  if (lec.status !== 'active') return res.status(409).json({ error: 'Attendance stopped' });
  
  // Also check at scan time (Strict Local Comparison)
  const now = new Date();
  const lectureStart = new Date(`${lec.lecture_date}T${lec.start_time}:00`);
  if (now < lectureStart) {
    return res.status(403).json({ error: 'Lecture has not started yet' });
  }

  if (lec.branch !== (payload.branch || lec.branch) && payload.branch)
    return res.status(403).json({ error: 'Branch mismatch' });

  const student = db.prepare('SELECT * FROM students WHERE rollno = ?').get(payload.rollno);
  if (!student) return res.status(404).json({ error: 'Unknown student' });
  if (student.branch !== lec.branch)
    return res.status(403).json({ error: 'Student not in lecture branch' });

  try {
    db.prepare(`
      INSERT INTO attendance (lecture_id, student_rollno, student_name, scanned_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(payload.lectureId, payload.rollno, payload.name);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.json({
        ok: true,
        alreadyMarked: true,
        rollno: payload.rollno,
        name: payload.name,
        lectureId: payload.lectureId
      });
    }
    return res.status(500).json({ error: 'DB error', detail: String(e) });
  }

  res.json({
    ok: true,
    alreadyMarked: false,
    rollno: payload.rollno,
    name: payload.name,
    lectureId: payload.lectureId
  });
});

app.listen(PORT, () => console.log(`Smart Attendance running → http://localhost:${PORT}`));