const mongoose = require('mongoose');
const User = require('./models/User');
const Class = require('./models/Class');
const Student = require('./models/Student');
const QuestionSet = require('./models/QuestionSet');
const Question = require('./models/Question');
const Card = require('./models/Card');
const { hashPassword } = require('./auth');

// Card number -> 25-char grid, row-major, 1 = black, 0 = white, card upright with answer A on top.
const CARDS = {
  1: '1111111111110111111110101'
  ,2: '1101111111110110111111111'
  ,3: '1111111111010111111110001'
  ,4: '1111111110110111111110111'
  ,5: '1111111110110101111010111'
  ,6: '1001111111110101111011111'
  ,7: '1100101111110110111111111'
  ,8: '1101111111110111111111101'
  ,9:  '1101111111110111111110001'
  ,10: '1111111110010101111111011'
  ,11: '1101111111010111111110101'
  ,12: '1101101111110111111111001'
  ,13: '1111111110010111111010111'
  ,14: '1100111111110100111111111'
  ,15: '1111111110010101111010011'
  ,16: '1111111111110110111011111'
  ,17: '1000111111110111111110111'
  ,18: '1110111111010111111111001'
  ,19: '1010111111110101111110111'
  ,20: '1110111111010110111011111'
  ,21: '1010111111110111111010111'
  ,22: '1110101111010111111111101'
  ,23: '1110101111010111111110001'
  ,24: '1001111111110111111110011'
  ,25: '1010111111110111111110011'
  ,26: '1101111111110100111011111'
  ,27: '1111101110010101111011011'
  ,28: '1111101110010111111110111'
  ,29: '1110101111010100111011111'
  ,30: '1100101111010111111111001'
  ,31: '1100101111110100111011111'
  ,32: '1111111111110101111111101'
  ,33: '1111101111010110111111011'
  ,34: '1101111111010110111111011'
  ,35: '1101101111110110111111011'
  ,36: '1110111111010110111111011'
  ,37: '1110101111110110111111011'
  ,38: '1101111110110111111110011'
  ,39: '1111101111010101111110001'
  ,40: '1101111110010101111111111'
  // ,41: ''
  // ,42: ''
  // ,43: ''
  // ,44: ''
  // ,45: ''
  // ,46: ''
};

async function seedDB() {
  const bad = Object.entries(CARDS).filter(([, g]) => !/^[01]{25}$/.test(g));
  if (bad.length) {
    console.error('Invalid card grids (need exactly 25 chars of 0/1):');
    bad.forEach(([id, g]) => console.error(`  card ${id}: ${g.length} chars`));
    process.exit(1);
  }

  await mongoose.connect('mongodb://127.0.0.1:27017/math_clicker');

  // Clear existing data
  await Promise.all([
    User.deleteMany({}),
    Class.deleteMany({}),
    Student.deleteMany({}),
    QuestionSet.deleteMany({}),
    Question.deleteMany({}),
    Card.deleteMany({})
  ]);

  // 1. Create Teacher User
  const teacher = await User.create({
    name: "Mr. Passon",
    email: "passosc@nv.ccsd.net",
    passwordHash: hashPassword(process.env.SEED_PASSWORD || 'changeme123')
  });

  // 2. Create Class
  const algebraClass = await Class.create({
    teacherId: teacher._id,
    name: "Algebra 1 - Period 3",
    academicYear: "2025-2026"
  });

  // 3. Create Students (linked to card numbers)
  await Student.insertMany([
    { classId: algebraClass._id, firstName: "Alice", lastName: "Johnson", studentNumber: "S101", sortOrder: 1, cardId: 1 },
    { classId: algebraClass._id, firstName: "Bob", lastName: "Smith", studentNumber: "S102", sortOrder: 2, cardId: 2 },
    { classId: algebraClass._id, firstName: "Charlie", lastName: "Davis", presentedName: "Chuck", sortOrder: 3, cardId: 3 },
    { classId: algebraClass._id, firstName: "Diana", lastName: "Prince", sortOrder: 4, cardId: 4 }
  ]);

  // Card patterns the camera matches against
  await Card.insertMany(Object.entries(CARDS).map(([cardId, grid]) => ({ cardId: Number(cardId), grid })));

  // 4. Create Question Set
  const qSet = await QuestionSet.create({
    teacherId: teacher._id,
    title: "Linear Equations & Slopes",
    subject: "Algebra"
  });

  // 5. Create Questions, then attach them to the set in order
  const questions = await Question.insertMany([
    {
      teacherId: teacher._id,
      questionType: 'multiple-choice',
      prompt: "What is the slope of the line passing through $(2, 3)$ and $(4, 7)$?",
      options: ["$1$", "$2$", "$3$", "$4$"],
      correctAnswerIndex: 1 // 2
    },
    {
      teacherId: teacher._id,
      questionType: 'multiple-choice',
      prompt: "Solve for $x$: $3x - 5 = 10$",
      options: ["$x = 3$", "$x = 5$", "$x = 7.5$", "$x = 15$"],
      correctAnswerIndex: 1 // x = 5
    },
    {
      teacherId: teacher._id,
      questionType: 'poll',
      prompt: "How confident do you feel about slopes?",
      options: ["Not at all", "A little", "Mostly", "Fully"]
    }
  ]);
  qSet.questions = questions.map(q => q._id);
  await qSet.save();

  console.log("Database seeded successfully with local mock data!");
  mongoose.connection.close();
}

seedDB().catch(err => console.error(err));