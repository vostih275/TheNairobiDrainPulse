require('dotenv').config();
const mongoose = require('mongoose');
const Crew = require('../models/Crew');

const CREWS = [
  {
    crewName: 'Unit 1 - Manual Desilting Crew',
    loginIdentifier: 'unit1_tablet',
    leaderPassword: 'admin123',
    sharedPassword: 'worker123',
    members: [
      { memberId: 'M-001', name: 'David Ochieng', role: 'Leader' },
      { memberId: 'M-002', name: 'Peter Mwangi', role: 'Operator' },
      { memberId: 'M-003', name: 'Grace Wanjiru', role: 'Labourer' }
    ]
  },
  {
    crewName: 'Unit 2 - Large Vacuum Truck',
    loginIdentifier: 'unit2_tablet',
    leaderPassword: 'admin123',
    sharedPassword: 'worker123',
    members: [
      { memberId: 'M-004', name: 'John Kamau', role: 'Leader' },
      { memberId: 'M-005', name: 'Susan Njeri', role: 'Operator' }
    ]
  },
  {
    crewName: 'Unit 3 - High-Pressure Jetting Unit',
    loginIdentifier: 'unit3_tablet',
    leaderPassword: 'admin123',
    sharedPassword: 'worker123',
    members: [
      { memberId: 'M-006', name: 'Michael Odhiambo', role: 'Leader' },
      { memberId: 'M-007', name: 'Alice Achieng', role: 'Technician' },
      { memberId: 'M-008', name: 'Daniel Kipchirchir', role: 'Assistant' }
    ]
  },
  {
    crewName: 'Unit 4 - Vacuum/Jetting Combo',
    loginIdentifier: 'unit4_tablet',
    leaderPassword: 'admin123',
    sharedPassword: 'worker123',
    members: [
      { memberId: 'M-009', name: 'Faith Muthoni', role: 'Leader' },
      { memberId: 'M-010', name: 'Brian Otieno', role: 'Driver' },
      { memberId: 'M-011', name: 'Cynthia Chepkoech', role: 'Operator' }
    ]
  }
];

async function seedCrews() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[SEED:CREWS] Connected to MongoDB');
  await Crew.deleteMany({});
  console.log('[SEED:CREWS] Cleared existing crews');
  const inserted = await Crew.insertMany(CREWS);
  for (const crew of inserted) {
    console.log(`[SEED:CREWS] Inserted ${crew.crewName} with ${crew.members.length} members`);
  }
  console.log('[SEED:CREWS] Done!');
  process.exit(0);
}

seedCrews().catch(err => { console.error('[SEED:CREWS ERROR]', err); process.exit(1); });
