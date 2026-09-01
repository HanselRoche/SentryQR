import { getDb, closeDb } from './index.js';
import { createUser, findByUsername } from '../services/users.js';

/**
 * Demo accounts. Passwords are intentionally simple and printed below — this is
 * a demo fixture, not a deployment. A real deployment would enrol the first
 * admin out of band.
 */
const ACCOUNTS = [
  { username: 'admin', password: 'admin12345', fullName: 'Hostel Warden', role: 'admin' },
  { username: 'guard.ramesh', password: 'guard12345', fullName: 'Ramesh Kamath', role: 'guard' },
  { username: 'guard.suma', password: 'guard12345', fullName: 'Suma Shetty', role: 'guard' },
  {
    username: 's.aisha',
    password: 'student12345',
    fullName: 'Aisha Rahman',
    role: 'student',
    rollNo: '4SO22CS001',
    roomNo: 'B-204',
    hostelBlock: 'B',
  },
  {
    username: 's.rahul',
    password: 'student12345',
    fullName: 'Rahul Nayak',
    role: 'student',
    rollNo: '4SO22CS002',
    roomNo: 'A-101',
    hostelBlock: 'A',
  },
  {
    username: 's.fatima',
    password: 'student12345',
    fullName: 'Fatima Noor',
    role: 'student',
    rollNo: '4SO22CS003',
    roomNo: 'B-207',
    hostelBlock: 'B',
  },
];

getDb();

// The admin role cannot be created through the API — createUser is reachable
// only from an admin-only route that accepts student|guard — so the first admin
// has to come from here.
const db = getDb();
let created = 0;
let skipped = 0;

for (const account of ACCOUNTS) {
  if (findByUsername(account.username)) {
    skipped += 1;
    continue;
  }

  if (account.role === 'admin') {
    const { hashPassword } = await import('../crypto/password.js');
    const { hash, salt } = hashPassword(account.password);
    db.prepare(
      `INSERT INTO users (username, password_hash, password_salt, role, full_name, created_at)
       VALUES (?, ?, ?, 'admin', ?, ?)`,
    ).run(account.username, hash, salt, account.fullName, Date.now());
  } else {
    createUser(account);
  }
  created += 1;
}

console.log(`Seed complete — ${created} account(s) created, ${skipped} already present.\n`);
console.log('  role     username        password');
console.log('  ------------------------------------------');
for (const account of ACCOUNTS) {
  console.log(`  ${account.role.padEnd(8)} ${account.username.padEnd(15)} ${account.password}`);
}
console.log('\nStudents have no device key yet — enrol one by logging into the student app.');

closeDb();
