const Student = require('./models/Student');
const QuestionSet = require('./models/QuestionSet');
const Response = require('./models/Response');

// Teacher-chosen sortOrder first (blanks last), then last and first name.
function sortStudents(list) {
  return [...list].sort((a, b) => {
    const ao = a.sortOrder ?? Infinity;
    const bo = b.sortOrder ?? Infinity;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || '');
  });
}

const studentInfo = (s) => ({
  _id: s._id,
  name: s.name,
  firstName: s.firstName,
  lastName: s.lastName,
  presentedName: s.presentedName,
  studentNumber: s.studentNumber,
  sortOrder: s.sortOrder,
  cardId: s.cardId
});

// Per-student answers for every question in one set, for one class.
async function setResults(classId, teacherId, setId) {
  const set = await QuestionSet.findOne({ _id: setId, teacherId }).populate('questions');
  if (!set) return null;
  const [students, responses] = await Promise.all([
    Student.find({ classId }),
    Response.find({ classId, questionSetId: set._id })
  ]);
  const byKey = new Map(responses.map(r => [`${r.studentId}:${r.questionId}`, r]));

  return {
    set: { _id: set._id, title: set.title, subject: set.subject },
    questions: set.questions.map(q => ({ _id: q._id, prompt: q.prompt, questionType: q.questionType })),
    students: sortStudents(students).map(s => {
      const answers = set.questions.map(q => {
        const r = byKey.get(`${s._id}:${q._id}`);
        return r ? { selectedAnswerIndex: r.selectedAnswerIndex, isCorrect: r.isCorrect } : null;
      });
      return {
        ...studentInfo(s),
        answers,
        total: set.questions.length,
        answered: answers.filter(Boolean).length,
        correct: answers.filter(a => a && a.isCorrect === true).length
      };
    })
  };
}

// Summary of every set asked in a class. from/to filter on when a set was first asked.
async function gradebook(classId, teacherId, from, to) {
  const asked = await Response.aggregate([
    { $match: { classId, questionSetId: { $ne: null } } },
    { $group: { _id: '$questionSetId', firstAt: { $min: '$timestamp' }, lastAt: { $max: '$timestamp' } } }
  ]);
  const inRange = asked.filter(a => (!from || a.firstAt >= from) && (!to || a.firstAt <= to));
  const sets = await QuestionSet.find({ _id: { $in: inRange.map(a => a._id) }, teacherId });
  const askedById = new Map(inRange.map(a => [String(a._id), a]));
  const orderedSets = sets.sort((a, b) => askedById.get(String(a._id)).firstAt - askedById.get(String(b._id)).firstAt);

  const [students, responses] = await Promise.all([
    Student.find({ classId }),
    Response.find({ classId, questionSetId: { $in: orderedSets.map(s => s._id) } })
  ]);

  const questionIds = new Map(orderedSets.map(s => [String(s._id), new Set(s.questions.map(String))]));
  const tally = new Map(); // `${studentId}:${setId}` -> { answered, correct }
  for (const r of responses) {
    if (!questionIds.get(String(r.questionSetId)).has(String(r.questionId))) continue;
    const key = `${r.studentId}:${r.questionSetId}`;
    const t = tally.get(key) || { answered: 0, correct: 0 };
    t.answered++;
    if (r.isCorrect === true) t.correct++;
    tally.set(key, t);
  }

  return {
    sets: orderedSets.map(s => ({
      _id: s._id,
      title: s.title,
      subject: s.subject,
      total: s.questions.length,
      firstAt: askedById.get(String(s._id)).firstAt,
      lastAt: askedById.get(String(s._id)).lastAt
    })),
    students: sortStudents(students).map(s => ({
      ...studentInfo(s),
      summaries: Object.fromEntries(orderedSets.map(set => {
        const t = tally.get(`${s._id}:${set._id}`) || { answered: 0, correct: 0 };
        return [set._id, { total: set.questions.length, ...t }];
      }))
    }))
  };
}

module.exports = { sortStudents, studentInfo, setResults, gradebook };
