require('dotenv').config();
const { pgPool } = require('../config/db');

const seed = async () => {
  try {
    await pgPool.query(`
      INSERT INTO wall_of_fame (name, achievement, description, term, year, category, is_active, sort_order)
      VALUES 
        ('IRONCREED', 'Best Sports Club 2024', 'Awarded for unparalleled dominance in inter-university tournaments and promoting a culture of fitness.', 'Semester 4', '2024-25', 'Sports', true, 1),
        ('Android Dev Club', 'Google Solutions Challenge Finalist', 'Recognized for developing an innovative healthcare app that reached the global top 100 finalists.', 'Fall Intake', '2024-25', 'Tech', true, 2),
        ('Bumblebeez', 'Cultural Excellence Award', 'Celebrated for their breathtaking performance at the Annual Gala, blending traditional and modern dance.', 'Annual Term', '2024-25', 'Cultural', true, 3),
        ('SOAC Council', 'Outstanding Leadership 2024', 'For exceptional coordination and management of the university club ecosystem.', 'Academic Year', '2024-25', 'Academic', true, 4)
    `);
    console.log('✅ Wall of Fame seeded.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding:', err);
    process.exit(1);
  }
};

seed();
