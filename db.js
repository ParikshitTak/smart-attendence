import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database(process.env.RENDER_DISK_PATH ? `${process.env.RENDER_DISK_PATH}/attendance.db` : 'attendance.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rollno TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  branch TEXT NOT NULL,
  room TEXT NOT NULL,
  lecture_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | stopped
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(teacher_id) REFERENCES teachers(id)
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER NOT NULL,
  student_rollno TEXT NOT NULL,
  student_name TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lecture_id, student_rollno),
  FOREIGN KEY(lecture_id) REFERENCES lectures(id)
);
`);

// ---- Seed demo data (only if empty) ----
const tCount = db.prepare('SELECT COUNT(*) c FROM teachers').get().c;
if (tCount === 0) {
  const hash = (p) => bcrypt.hashSync(p, 10);
  db.prepare('INSERT INTO teachers (name, password) VALUES (?, ?)')
    .run('prof_sharma', hash('teacher123'));
  db.prepare('INSERT INTO teachers (name, password) VALUES (?, ?)')
    .run('prof_iyer', hash('teacher123'));

  const studs = [
    ['Aarav Mehta',   'CSE001', 'CSE'],
    ['Diya Patel',    'CSE002', 'CSE'],
    ['Ishaan Rao',    'CSE003', 'CSE'],
    ['Kavya Nair',    'CSE004', 'CSE'],
    ['Rohan Verma',   'CSE005', 'CSE'],
    ['Sara Khan',     'IT001',  'IT'],
    ['Vivaan Joshi',  'IT002',  'IT'],
    ['Ananya Gupta',  'ECE001', 'ECE']
  ];
  const ins = db.prepare('INSERT INTO students (name, rollno, branch, password) VALUES (?,?,?,?)');
  for (const [n, r, b] of studs) ins.run(n, r, b, hash('student123'));

  console.log('Seeded demo teachers (prof_sharma / teacher123) and students (CSE001 / student123)');
}

export default db;