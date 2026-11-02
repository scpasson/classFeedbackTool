require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const User = require('./models/User');
const Class = require('./models/Class');
const Student = require('./models/Student');
const QuestionSet = require('./models/QuestionSet');
const Question = require('./models/Question');
const Response = require('./models/Response');
const Card = require('./models/Card');
const auth = require('./auth');
const results = require('./results');

const app = express();
const server = http.createServer(app);
const io = new Server();
io.attach(server);

app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use(auth.loadUser);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- PAGE ROUTES ---
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/login', (req, res) => req.user ? res.redirect(safeNext(req.query.next)) : res.render('login'));
app.get('/register', (req, res) => req.user ? res.redirect('/') : res.render('register'));
for (const page of ['dashboard', 'presentation', 'questionSets', 'discover', 'bookmarks', 'results', 'gradebook']) {
  app.get(`/${page}`, auth.requirePage, (req, res) => res.render(page));
}
app.get('/questions', (req, res) => res.redirect('/questionSets'));

// Shareable link: public sets are viewable without logging in; private sets only by their owner.
app.get('/questionSet/:id', async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return next();
    const set = await QuestionSet.findOne({ _id: req.params.id, ...visibleToUser(req) }, 'title');
    if (!set) {
      if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return res.status(404).send('Question set not found');
    }
    res.render('question-set', { setId: set._id, user: req.user || null });
  } catch (err) { next(err); }
});
app.get('/active', auth.requirePage, (req, res) => res.render('active-session'));
app.get('/account', auth.requirePage, (req, res) => res.render('account', { user: req.user }));


//const dbUrl=process.env.MONGODB_URI
const dbUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/math_clicker';

// Connect to Local MongoDB

mongoose.connect(dbUrl)
  .then(async () => {
    console.log('MongoDB connected');
    await migrateLegacyData();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Older data had a single `name` on students and no question set on responses.
async function migrateLegacyData() {
  const legacyStudents = await Student.collection.find({ name: { $exists: true }, firstName: { $exists: false } }).toArray();
  for (const s of legacyStudents) {
    const parts = String(s.name || '').trim().split(/\s+/);
    const firstName = parts.shift() || '?';
    await Student.collection.updateOne(
      { _id: s._id },
      { $set: { firstName, lastName: parts.join(' ') || '-', presentedName: '', sortOrder: null }, $unset: { name: '' } }
    );
  }

  const orphanQuestionIds = await Response.distinct('questionId', { questionSetId: { $exists: false } });
  for (const questionId of orphanQuestionIds) {
    const set = await QuestionSet.findOne({ questions: questionId });
    if (set) await Response.updateMany({ questionId, questionSetId: { $exists: false } }, { $set: { questionSetId: set._id } });
  }
}

// --- HELPERS ---
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const ownClass = async (req, id) => {
  const cls = await Class.findOne({ _id: id, teacherId: req.user._id });
  if (!cls) throw httpError(404, 'Class not found');
  return cls;
};

const ownSet = async (req, id) => {
  const set = await QuestionSet.findOne({ _id: id, teacherId: req.user._id });
  if (!set) throw httpError(404, 'Question set not found');
  return set;
};

async function getSetQuestions(setId, teacherId) {
  const set = await QuestionSet.findOne({ _id: setId, teacherId }).populate('questions');
  return set ? set.questions : [];
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return list.map(t => String(t).trim()).filter(Boolean);
}

function cleanQuestion(q) {
  const questionType = q.questionType === 'poll' ? 'poll' : 'multiple-choice';
  const idx = parseInt(q.correctAnswerIndex, 10);
  return {
    questionType,
    prompt: String(q.prompt || '').trim(),
    options: (Array.isArray(q.options) ? q.options : []).map(o => String(o).trim()),
    tags: cleanTags(q.tags),
    shuffleOptions: q.shuffleOptions === true || q.shuffleOptions === 'true',
    correctAnswerIndex: questionType === 'poll' || Number.isNaN(idx) ? undefined : idx
  };
}

const str = (v) => String(v ?? '').trim();
const normEmail = (v) => str(v).toLowerCase();
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// --- AUTH ---
const failedLogins = new Map(); // ip -> { count, until }
const MAX_FAILS = 10;
const LOCK_MS = 5 * 60 * 1000;

const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email });

app.post('/api/auth/register', wrap(async (req, res) => {
  const name = str(req.body.name);
  const email = normEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists' });

  let user;
  try {
    user = await User.create({ name, email, passwordHash: auth.hashPassword(password) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }
  auth.startSession(res, user);
  res.status(201).json(publicUser(user));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const ip = req.ip;
  const fails = failedLogins.get(ip);
  if (fails && fails.count >= MAX_FAILS && fails.until > Date.now()) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }
  const user = await User.findOne({ email: normEmail(req.body.email) });
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.passwordHash)) {
    failedLogins.set(ip, { count: (fails && fails.until > Date.now() ? fails.count : 0) + 1, until: Date.now() + LOCK_MS });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  failedLogins.delete(ip);
  auth.startSession(res, user);
  res.json(publicUser(user));
}));

app.post('/api/auth/logout', (req, res) => {
  auth.endSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth.requireApi, (req, res) => res.json(publicUser(req.user)));

app.put('/api/auth/me', auth.requireApi, wrap(async (req, res) => {
  const name = str(req.body.name);
  const email = normEmail(req.body.email);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (await User.exists({ email, _id: { $ne: req.user._id } })) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }
  req.user.set({ name, email });
  await req.user.save();
  res.json(publicUser(req.user));
}));

app.put('/api/auth/password', auth.requireApi, wrap(async (req, res) => {
  const newPassword = String(req.body.newPassword || '');
  if (!auth.verifyPassword(String(req.body.currentPassword || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  req.user.passwordHash = auth.hashPassword(newPassword);
  await req.user.save();
  res.json({ ok: true });
}));

app.delete('/api/auth/me', auth.requireApi, wrap(async (req, res) => {
  if (!auth.verifyPassword(String(req.body.password || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Password is incorrect' });
  }
  const classes = await Class.find({ teacherId: req.user._id }, '_id');
  const classIds = classes.map(c => c._id);
  await Response.deleteMany({ classId: { $in: classIds } });
  await Student.deleteMany({ classId: { $in: classIds } });
  await Class.deleteMany({ teacherId: req.user._id });
  await QuestionSet.deleteMany({ teacherId: req.user._id });
  await Question.deleteMany({ teacherId: req.user._id });
  await fs.promises.rm(path.join(UPLOAD_ROOT, String(req.user._id)), { recursive: true, force: true });
  await User.findByIdAndDelete(req.user._id);
  sessions.delete(String(req.user._id));
  auth.endSession(res);
  res.json({ ok: true });
}));

// --- PUBLIC QUESTION SET READS (work without logging in) ---
const visibleToUser = (req) => (req.user
  ? { $or: [{ isPublic: { $ne: false } }, { teacherId: req.user._id }] }
  : { isPublic: { $ne: false } });

async function viewSet(req, id) {
  const set = await QuestionSet.findOne({ _id: id, ...visibleToUser(req) });
  if (!set) throw httpError(404, 'Question set not found');
  return set;
}

function shapeSet(set, req) {
  const o = set.toObject();
  const ownerId = o.teacherId._id || o.teacherId;
  return {
    ...o,
    teacherId: ownerId,
    ownerName: o.teacherId.name || '',
    mine: !!req.user && String(ownerId) === String(req.user._id),
    bookmarked: !!req.user && req.user.bookmarkedSets.some(id => String(id) === String(o._id)),
    isPublic: o.isPublic !== false,
    modifiedAt: o.updatedAt || o.createdAt
  };
}

app.get('/api/question-sets/:setId', wrap(async (req, res, next) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.setId)) return next();
  const set = await viewSet(req, req.params.setId);
  await set.populate('teacherId', 'name');
  res.json({ ...shapeSet(set, req), loggedIn: !!req.user });
}));

app.get('/api/question-sets/:setId/questions', wrap(async (req, res, next) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.setId)) return next();
  const set = await viewSet(req, req.params.setId);
  await set.populate('questions');
  res.json(set.questions);
}));

// Everything below needs a logged-in teacher.
app.use('/api', auth.requireApi);

// --- IMAGE UPLOADS (private per teacher) ---
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const IMAGE_TYPES = [
  { ext: 'png', match: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', match: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', match: b => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')) },
  { ext: 'webp', match: b => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
];
const UPLOAD_REF = /\/uploads\/([a-f0-9]{24})\/([a-f0-9]{32}\.(?:png|jpg|gif|webp))/g;

// Images are shared with public sets, so anyone with the (unguessable) file name can fetch one.
app.use('/uploads', express.static(UPLOAD_ROOT, { dotfiles: 'deny', index: false, setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));

app.post('/api/uploads', express.raw({ type: 'image/*', limit: '2mb' }), wrap(async (req, res) => {
  const buf = req.body;
  const kind = Buffer.isBuffer(buf) && IMAGE_TYPES.find(t => t.match(buf));
  if (!kind) return res.status(400).json({ error: 'Upload a PNG, JPEG, GIF or WebP image under 2 MB' });
  const dir = path.join(UPLOAD_ROOT, String(req.user._id));
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${require('crypto').randomBytes(16).toString('hex')}.${kind.ext}`;
  await fs.promises.writeFile(path.join(dir, name), buf);
  res.status(201).json({ url: `/uploads/${req.user._id}/${name}` });
}));

// Delete uploaded files named in `texts` that no remaining question of this teacher still uses.
async function pruneUploads(teacherId, texts) {
  const files = new Set();
  for (const t of texts) for (const m of String(t).matchAll(UPLOAD_REF)) if (m[1] === String(teacherId)) files.add(m[2]);
  if (!files.size) return;
  const rest = await Question.find({ teacherId }, 'prompt options');
  const used = new Set();
  for (const q of rest) for (const t of [q.prompt, ...q.options]) for (const m of String(t).matchAll(UPLOAD_REF)) used.add(m[2]);
  for (const f of files) if (!used.has(f)) await fs.promises.rm(path.join(UPLOAD_ROOT, String(teacherId), f), { force: true });
}

// --- API ROUTES FOR TEACHER CRUD ---
app.get('/api/classes', wrap(async (req, res) => {
  res.json(await Class.find({ teacherId: req.user._id }));
}));

app.post('/api/classes', wrap(async (req, res) => {
  const { name, academicYear } = req.body;
  const cls = await Class.create({ teacherId: req.user._id, name, academicYear });
  res.status(201).json(cls);
}));

app.put('/api/classes/:classId', wrap(async (req, res) => {
  const { name, academicYear } = req.body;
  const cls = await Class.findOneAndUpdate(
    { _id: req.params.classId, teacherId: req.user._id },
    { name, academicYear },
    { returnDocument: 'after', runValidators: true }
  );
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  res.json(cls);
}));

app.delete('/api/classes/:classId', wrap(async (req, res) => {
  const cls = await ownClass(req, req.params.classId);
  await Response.deleteMany({ classId: cls._id });
  await Student.deleteMany({ classId: cls._id });
  await Class.findByIdAndDelete(cls._id);
  res.json({ ok: true });
}));

app.get('/api/classes/:classId/students', wrap(async (req, res) => {
  const cls = await ownClass(req, req.params.classId);
  res.json(results.sortStudents(await Student.find({ classId: cls._id })));
}));

function cleanStudent(b) {
  const sortRaw = str(b.sortOrder);
  return {
    firstName: str(b.firstName),
    lastName: str(b.lastName),
    presentedName: str(b.presentedName),
    studentNumber: str(b.studentNumber),
    sortOrder: sortRaw === '' ? null : Number(sortRaw),
    cardId: b.cardId
  };
}

async function validateStudent(classId, s, ignoreId) {
  // Critical errors (blocking)
  if (!s.firstName || !s.lastName || !s.cardId) {
    return { error: 'First name, last name and card are required', warning: null };
  }
  if (s.sortOrder !== null && s.sortOrder !== undefined && !Number.isFinite(s.sortOrder)) {
    return { error: 'Sort order must be a number', warning: null };
  }
  if (!Number.isInteger(Number(s.cardId)) || Number(s.cardId) < 1) {
    return { error: 'Card must be a whole number, 1 or higher', warning: null };
  }

  // Duplicate check (non-blocking warning)
  const dup = await Student.findOne({ classId, cardId: s.cardId, _id: { $ne: ignoreId } });
  const warning = dup 
    ? `Warning: Card ${s.cardId} is already assigned to ${dup.name || `${dup.firstName} ${dup.lastName}`}` 
    : null;

  return { error: null, warning };
}

app.post('/api/classes/:classId/students', wrap(async (req, res) => {
  const cls = await ownClass(req, req.params.classId);
  const data = cleanStudent(req.body);
  const { error, warning } = await validateStudent(cls._id, data);
  if (error) return res.status(400).json({ error });
  const created = await Student.create({ classId: cls._id, ...data });
  res.status(201).json({ ...created.toObject(), warning });
}));

app.put('/api/students/:id', wrap(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  await ownClass(req, student.classId);
  const data = cleanStudent(req.body);
  const { error, warning } = await validateStudent(student.classId, data, student._id);
  if (error) return res.status(400).json({ error });
  student.set(data);
  await student.save();
  res.json({ ...student.toObject(), warning });
}));

app.delete('/api/students/:id', wrap(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  await ownClass(req, student.classId);
  await Response.deleteMany({ studentId: student._id });
  await Student.findByIdAndDelete(student._id);
  res.json({ ok: true });
}));

// Card patterns are physical cards, shared by every account.
app.get('/api/cards', wrap(async (req, res) => {
  res.json(await Card.find({}, 'cardId grid -_id').sort('cardId'));
}));

app.put('/api/cards/:cardId', wrap(async (req, res) => {
  const card = await Card.findOneAndUpdate(
    { cardId: req.params.cardId },
    { grid: String(req.body.grid || '') },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
  res.json({ cardId: card.cardId, grid: card.grid });
}));

app.delete('/api/cards/:cardId', wrap(async (req, res) => {
  await Card.deleteOne({ cardId: req.params.cardId });
  res.json({ ok: true });
}));

// --- QUESTION SETS (public by default; owners may make them private) ---
async function listSets(req, filter) {
  const sets = await QuestionSet.find(filter).populate('teacherId', 'name');
  return sets.map(s => shapeSet(s, req));
}

function cleanSetBody(body) {
  const title = str(body.title);
  const subject = str(body.subject);
  if (!title || !subject) throw httpError(400, 'Title and subject are required');
  return { title, subject, tags: cleanTags(body.tags) };
}

app.get('/api/question-sets', wrap(async (req, res) => {
  const filter = { teacherId: req.user._id };
  if (req.query.active === 'true') filter.active = { $ne: false };
  res.json(await listSets(req, filter));
}));

app.get('/api/question-sets/discover', wrap(async (req, res) => {
  const filter = { isPublic: { $ne: false } };
  const q = str(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { subject: rx }, { tags: rx }];
  }
  res.json(await listSets(req, filter));
}));

app.get('/api/question-sets/bookmarks', wrap(async (req, res) => {
  res.json(await listSets(req, { _id: { $in: req.user.bookmarkedSets }, ...visibleToUser(req) }));
}));

app.post('/api/question-sets', wrap(async (req, res) => {
  const set = await QuestionSet.create({
    teacherId: req.user._id, ...cleanSetBody(req.body),
    active: req.body.active !== false, isPublic: req.body.isPublic !== false
  });
  res.status(201).json(set);
}));

app.put('/api/question-sets/:setId', wrap(async (req, res) => {
  const update = cleanSetBody(req.body);
  if (typeof req.body.active === 'boolean') update.active = req.body.active;
  if (typeof req.body.isPublic === 'boolean') update.isPublic = req.body.isPublic;
  const set = await QuestionSet.findOneAndUpdate(
    { _id: req.params.setId, teacherId: req.user._id }, update, { returnDocument: 'after', runValidators: true }
  );
  if (!set) return res.status(404).json({ error: 'Question set not found' });
  res.json(set);
}));

app.patch('/api/question-sets/:setId/active', wrap(async (req, res) => {
  const set = await QuestionSet.findOneAndUpdate(
    { _id: req.params.setId, teacherId: req.user._id }, { active: req.body.active === true },
    { returnDocument: 'after', timestamps: false }
  );
  if (!set) return res.status(404).json({ error: 'Question set not found' });
  res.json(set);
}));

app.delete('/api/question-sets/:setId', wrap(async (req, res) => {
  const set = await ownSet(req, req.params.setId);
  await QuestionSet.findByIdAndDelete(set._id);
  await User.updateMany({ bookmarkedSets: set._id }, { $pull: { bookmarkedSets: set._id } });
  res.json({ ok: true });
}));

app.put('/api/question-sets/:setId/bookmark', wrap(async (req, res) => {
  const set = await viewSet(req, req.params.setId);
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { bookmarkedSets: set._id } });
  res.json({ ok: true });
}));

app.delete('/api/question-sets/:setId/bookmark', wrap(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $pull: { bookmarkedSets: req.params.setId } });
  res.json({ ok: true });
}));

// Copy a file referenced as /uploads/<otherUser>/... into this user's folder and rewrite the reference.
async function adoptUploads(text, userId) {
  let out = String(text);
  const found = new Map();
  for (const m of out.matchAll(UPLOAD_REF)) if (m[1] !== String(userId)) found.set(m[0], m);
  for (const [full, m] of found) {
    const dir = path.join(UPLOAD_ROOT, String(userId));
    const name = `${require('crypto').randomBytes(16).toString('hex')}${path.extname(m[2])}`;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.copyFile(path.join(UPLOAD_ROOT, m[1], m[2]), path.join(dir, name));
      out = out.split(full).join(`/uploads/${userId}/${name}`);
    } catch { /* leave the original reference if the file is missing */ }
  }
  return out;
}

async function cloneQuestions(questionIds, userId) {
  const found = await Question.find({ _id: { $in: questionIds } });
  const byId = new Map(found.map(q => [String(q._id), q]));
  const docs = [];
  for (const id of questionIds) {
    const q = byId.get(String(id));
    if (!q) continue;
    docs.push(new Question({
      teacherId: userId,
      questionType: q.questionType,
      prompt: await adoptUploads(q.prompt, userId),
      options: await Promise.all(q.options.map(o => adoptUploads(o, userId))),
      tags: q.tags,
      shuffleOptions: q.shuffleOptions,
      correctAnswerIndex: q.correctAnswerIndex
    }));
  }
  if (docs.length) await Question.insertMany(docs);
  return docs;
}

app.post('/api/question-sets/:setId/clone', wrap(async (req, res) => {
  const src = await viewSet(req, req.params.setId);
  const mine = String(src.teacherId) === String(req.user._id);
  const docs = await cloneQuestions(src.questions, req.user._id);
  const copy = await QuestionSet.create({
    teacherId: req.user._id,
    title: mine ? `${src.title} (copy)` : src.title,
    subject: src.subject,
    tags: src.tags,
    questions: docs.map(d => d._id)
  });
  res.status(201).json(copy);
}));

app.put('/api/question-sets/:setId/questions', wrap(async (req, res) => {
  const set = await ownSet(req, req.params.setId);
  const { questionIds } = req.body;
  if (!Array.isArray(questionIds)) return res.status(400).json({ error: 'questionIds must be an array' });
  const owned = await Question.countDocuments({ _id: { $in: questionIds }, teacherId: req.user._id });
  if (owned !== new Set(questionIds.map(String)).size) return res.status(400).json({ error: 'Unknown question in list' });
  set.questions = questionIds;
  await set.save();
  res.json(await getSetQuestions(set._id, req.user._id));
}));

app.get('/api/questions', wrap(async (req, res) => {
  const { q, type, tag } = req.query;
  const shared = req.query.shared === 'true';
  let filter = { teacherId: req.user._id };
  if (shared) {
    const pub = await QuestionSet.find({ isPublic: { $ne: false }, teacherId: { $ne: req.user._id } }, 'questions');
    filter = { _id: { $in: pub.flatMap(s => s.questions) } };
  }
  if (q) {
    const rx = new RegExp(escapeRegex(String(q)), 'i');
    filter.$or = [{ prompt: rx }, { tags: rx }];
  }
  if (type) filter.questionType = String(type);
  if (tag) filter.tags = String(tag);
  const questions = await Question.find(filter).limit(200);

  const sets = shared ? [] : await QuestionSet.find({ teacherId: req.user._id, questions: { $in: questions.map(x => x._id) } }, 'title questions');
  res.json(questions.map(x => ({
    ...x.toObject(),
    shared,
    sets: sets.filter(s => s.questions.some(id => id.equals(x._id))).map(s => ({ _id: s._id, title: s.title }))
  })));
}));

app.post('/api/questions', wrap(async (req, res) => {
  const { questions, questionSetId } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions must be a non-empty array' });
  }
  const set = questionSetId ? await ownSet(req, questionSetId) : null;
  const docs = questions.map(q => new Question({ ...cleanQuestion(q), teacherId: req.user._id }));

  for (let i = 0; i < docs.length; i++) {
    try { await docs[i].validate(); }
    catch (err) { return res.status(400).json({ error: `Row ${i + 1}: ${err.message}` }); }
  }

  await Question.insertMany(docs);
  if (set) {
    await QuestionSet.findByIdAndUpdate(set._id, { $push: { questions: { $each: docs.map(d => d._id) } } });
  }
  res.status(201).json(docs);
}));

app.post('/api/questions/:id/clone', wrap(async (req, res) => {
  const src = await Question.findById(req.params.id);
  const visible = src && (String(src.teacherId) === String(req.user._id) ||
    await QuestionSet.exists({ questions: src._id, isPublic: { $ne: false } }));
  if (!visible) return res.status(404).json({ error: 'Question not found' });
  const [copy] = await cloneQuestions([src._id], req.user._id);
  if (req.body.questionSetId) {
    const set = await ownSet(req, req.body.questionSetId);
    await QuestionSet.findByIdAndUpdate(set._id, { $push: { questions: copy._id } });
  }
  res.status(201).json(copy);
}));

app.put('/api/questions/:id', wrap(async (req, res) => {
  const question = await Question.findOne({ _id: req.params.id, teacherId: req.user._id });
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const oldTexts = [question.prompt, ...question.options];
  question.set(cleanQuestion(req.body));
  await question.save();
  await QuestionSet.updateMany({ teacherId: req.user._id, questions: question._id }, { $set: { updatedAt: new Date() } });
  await pruneUploads(req.user._id, oldTexts);
  res.json(question);
}));

app.delete('/api/questions/:id', wrap(async (req, res) => {
  const question = await Question.findOne({ _id: req.params.id, teacherId: req.user._id });
  if (!question) return res.status(404).json({ error: 'Question not found' });
  await Question.findByIdAndDelete(question._id);
  await QuestionSet.updateMany({ teacherId: req.user._id, questions: question._id }, { $pull: { questions: question._id } });
  await Response.deleteMany({ questionId: question._id });
  await pruneUploads(req.user._id, [question.prompt, ...question.options]);
  res.json({ ok: true });
}));

// --- RESULTS & GRADEBOOK ---
app.get('/api/classes/:classId/question-sets/:setId/results', wrap(async (req, res) => {
  const cls = await ownClass(req, req.params.classId);
  const data = await results.setResults(cls._id, req.user._id, req.params.setId);
  if (!data) return res.status(404).json({ error: 'Question set not found' });
  res.json(data);
}));

// Dates are YYYY-MM-DD; "to" includes that whole day.
const parseDay = (v, endOfDay) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return null;
  return new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
};

app.get('/api/classes/:classId/gradebook', wrap(async (req, res) => {
  const cls = await ownClass(req, req.params.classId);
  res.json(await results.gradebook(cls._id, req.user._id, parseDay(req.query.from, false), parseDay(req.query.to, true)));
}));

// Express Error Handler Middleware
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.name === 'CastError' || err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- SESSION & SOCKET STATE (one live session per teacher) ---
const DISPLAY_MODES = ['question', 'question-options'];
const sessions = new Map(); // userId -> state
const room = (uid) => `teacher:${uid}`;

function getSession(uid) {
  if (!sessions.has(uid)) {
    sessions.set(uid, {
      classId: null,
      questionSetId: null,
      currentQuestionIndex: 0,
      displayMode: 'none',
      questions: [],
      optionOrders: new Map(), // questionId -> permutation (shuffled position -> original index)
      unassigned: new Map() // cardId -> answerIndex for scanned cards not assigned to a student in the class
    });
  }
  return sessions.get(uid);
}

const publicSession = (s) => ({
  classId: s.classId,
  questionSetId: s.questionSetId,
  currentQuestionIndex: s.currentQuestionIndex,
  displayMode: s.displayMode,
  questions: s.questions
});

function fisherYates(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Returns plain questions with options reordered (and correctAnswerIndex remapped) where shuffleOptions is set.
function applyShuffle(questions, optionOrders) {
  return questions.map(doc => {
    const q = doc.toObject ? doc.toObject() : { ...doc };
    if (!q.shuffleOptions || !Array.isArray(q.options) || q.options.length < 2) return q;
    const key = String(q._id);
    let order = optionOrders.get(key);
    if (!order || order.length !== q.options.length) {
      order = fisherYates(q.options.length);
      optionOrders.set(key, order);
    }
    const original = q.options;
    q.options = order.map(i => original[i]);
    if (q.questionType !== 'poll' && Number.isInteger(q.correctAnswerIndex)) {
      q.correctAnswerIndex = order.indexOf(q.correctAnswerIndex);
    }
    return q;
  });
}

async function loadSession(uid, classId, questionSetId) {
  const s = getSession(uid);
  s.optionOrders.clear();
  s.classId = classId;
  s.questionSetId = questionSetId;
  s.questions = applyShuffle(await getSetQuestions(questionSetId, uid), s.optionOrders);
  s.currentQuestionIndex = 0;
  s.displayMode = 'none';
  io.to(room(uid)).emit('session-updated', publicSession(s));
}

const liveFilter = (s, question) => ({ classId: s.classId, questionSetId: s.questionSetId, questionId: question._id });

async function sendResponsesForCurrentQuestion(uid) {
  const s = getSession(uid);
  s.unassigned.clear();
  io.to(room(uid)).emit('unassigned-scans-updated', []);
  const q = s.questions[s.currentQuestionIndex];
  const responses = q
    ? await Response.find(liveFilter(s, q)).populate('studentId', 'firstName lastName presentedName studentNumber')
    : [];
  io.to(room(uid)).emit('live-responses-updated', responses);
}

io.use(async (socket, next) => {
  try {
    const user = await auth.userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = String(user._id);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join(room(uid));

  socket.on('get-session', () => {
    const s = getSession(uid);
    if (s.classId) socket.emit('session-updated', publicSession(s));
  });

  socket.on('show-question', async ({ classId, questionSetId, questionIndex, displayMode }) => {
    try {
      const s = getSession(uid);
      if (String(classId) !== String(s.classId) || String(questionSetId) !== String(s.questionSetId)) {
        const [cls, set] = await Promise.all([
          Class.exists({ _id: classId, teacherId: uid }),
          QuestionSet.exists({ _id: questionSetId, teacherId: uid })
        ]);
        if (!cls || !set) return;
        await loadSession(uid, classId, questionSetId);
      } else {
        s.questions = applyShuffle(await getSetQuestions(questionSetId, uid), s.optionOrders);
      }

      if (!s.questions || questionIndex < 0 || questionIndex >= s.questions.length) return;

      s.currentQuestionIndex = questionIndex;
      s.displayMode = DISPLAY_MODES.includes(displayMode) ? displayMode : 'question-options';

      io.to(room(uid)).emit('show-question', {
        index: questionIndex,
        question: s.questions[questionIndex],
        displayMode: s.displayMode
      });

      await sendResponsesForCurrentQuestion(uid);
    } catch (err) {
      console.error('Error handling show-question:', err);
    }
  });

  // Discards every answer to the question on screen so it can be collected again.
  socket.on('clear-responses', async () => {
    try {
      const s = getSession(uid);
      const q = s.questions[s.currentQuestionIndex];
      if (!s.classId || !q || s.displayMode === 'none') return;
      await Response.deleteMany(liveFilter(s, q));
      s.unassigned.clear();
      io.to(room(uid)).emit('unassigned-scans-updated', []);
      io.to(room(uid)).emit('live-responses-updated', []);
      io.to(room(uid)).emit('responses-cleared');
    } catch (err) {
      console.error('Error clearing responses:', err);
    }
  });

  socket.on('submit-card-scan', async ({ cardId, answerIndex }) => {
    try {
      const s = getSession(uid);
      if (!s.classId || !s.questions || s.questions.length === 0) return;
      if (s.displayMode === 'none') return;

      const currentQuestion = s.questions[s.currentQuestionIndex];
      if (!currentQuestion) return;

      const student = await Student.findOne({ classId: s.classId, cardId });
      if (!student) {
        s.unassigned.set(String(cardId), answerIndex);
        io.to(room(uid)).emit('unassigned-scans-updated', [...s.unassigned].map(([id, a]) => ({ cardId: id, selectedAnswerIndex: a })));
        return;
      }

      const isPoll = currentQuestion.questionType === 'poll';
      const isCorrect = isPoll ? null : (answerIndex === currentQuestion.correctAnswerIndex);

      await Response.findOneAndUpdate(
        { ...liveFilter(s, currentQuestion), studentId: student._id },
        { selectedAnswerIndex: answerIndex, isCorrect, timestamp: new Date() },
        { upsert: true, new: true }
      );

      const responses = await Response.find(liveFilter(s, currentQuestion))
        .populate('studentId', 'firstName lastName presentedName studentNumber');

      io.to(room(uid)).emit('live-responses-updated', responses);
    } catch (err) {
      console.error('Error processing card scan:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Browsers only allow camera access on HTTPS or localhost, so phones need this.
async function getCert() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const lanIps = Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4').map(n => n.address);
  const altNames = [
    { type: 2, value: 'localhost' },
    ...['127.0.0.1', ...lanIps].map(ip => ({ type: 7, ip }))
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }]
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

server.listen(PORT, () => {
  console.log(`HTTP  server at http://localhost:${PORT}`);
});

getCert().then(({ key, cert }) => {
  const httpsServer = https.createServer({ key, cert }, app);
  io.attach(httpsServer);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`HTTPS server at https://localhost:${HTTPS_PORT}`);
  });
}).catch(err => console.error('HTTPS disabled:', err));
