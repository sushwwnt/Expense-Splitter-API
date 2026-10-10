import express, { Request, Response } from 'express';
import 'dotenv/config';
import { pool } from './db/db.js';
import { z } from 'zod';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Expense Splitter API is running smoothly #sobercodes !' });
});

// Zod schema for validation
const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
});

// 1. Create User API
app.post('/users', async (req: Request, res: Response) => {
  try {
    const validationResult = createUserSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { name, email } = validationResult.data;

    const queryText = `
      INSERT INTO users (name, email) 
      VALUES ($1, $2) 
      RETURNING id, name, email, created_at;
    `;
    
    const result = await pool.query(queryText, [name, email]);

    return res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Zod schema for group creation
const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  description: z.string().optional(),
  created_by: z.number().int().positive('Valid creator user ID is required'),
});

app.post('/groups', async (req: Request, res: Response) => {
  try {
    const validationResult = createGroupSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { name, description, created_by } = validationResult.data;

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [created_by]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Creator user not found' });
    }

    const groupQuery = `
      INSERT INTO groups (name, description, created_by) 
      VALUES ($1, $2, $3) 
      RETURNING id, name, description, created_by, created_at;
    `;
    const groupResult = await pool.query(groupQuery, [name, description || null, created_by]);
    const newGroup = groupResult.rows[0];

    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
      [newGroup.id, created_by]
    );

    return res.status(201).json({
      message: 'Group created successfully',
      group: newGroup,
    });
  } catch (error: any) {
    console.error('Error creating group:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Zod schema for adding a member
const addMemberSchema = z.object({
  user_id: z.number().int().positive('Valid user ID is required'),
});

app.post('/groups/:groupId/members', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const validationResult = addMemberSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { user_id } = validationResult.data;

    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = `
      INSERT INTO group_members (group_id, user_id) 
      VALUES ($1, $2) 
      RETURNING group_id, user_id, joined_at;
    `;
    
    const result = await pool.query(query, [groupId, user_id]);

    return res.status(201).json({
      message: 'Member added to group successfully',
      membership: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error adding member:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'User is already a member of this group' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Zod schema for expense creation
const createExpenseSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  paid_by: z.number().int().positive('Paid by user ID is required'),
  splits: z.array(
    z.object({
      user_id: z.number().int().positive(),
      amount: z.number().positive(),
    })
  ).min(1, 'At least one split is required'),
});

app.post('/groups/:groupId/expenses', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const validationResult = createExpenseSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { description, amount, paid_by, splits } = validationResult.data;

    const totalSplitAmount = splits.reduce((sum, split) => sum + split.amount, 0);
    if (Math.abs(totalSplitAmount - amount) > 0.01) {
      return res.status(400).json({ error: 'Sum of split amounts must equal total expense amount' });
    }

    await client.query('BEGIN');

    const expenseQuery = `
      INSERT INTO expenses (group_id, description, amount, paid_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, group_id, description, amount, paid_by, created_at;
    `;
    const expenseResult = await client.query(expenseQuery, [groupId, description, amount, paid_by]);
    const expense = expenseResult.rows[0];

    for (const split of splits) {
      const splitQuery = `
        INSERT INTO expense_splits (expense_id, user_id, amount)
        VALUES ($1, $2, $3);
      `;
      await client.query(splitQuery, [expense.id, split.user_id, split.amount]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Expense added and split successfully',
      expense,
      splits,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error adding expense:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET Group Expenses Endpoint
app.get('/groups/:groupId/expenses', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const query = `
      SELECT 
        e.id, 
        e.group_id, 
        e.description, 
        e.amount, 
        e.paid_by, 
        u.name AS paid_by_name, 
        e.created_at
      FROM expenses e
      JOIN users u ON e.paid_by = u.id
      WHERE e.group_id = $1
      ORDER BY e.created_at DESC;
    `;

    const result = await pool.query(query, [groupId]);

    return res.status(200).json({
      expenses: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching expenses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Zod schema for settlement validation matching schema.sql columns (from_user, to_user)
const createSettlementSchema = z.object({
  from_user: z.number().int().positive('From user ID is required'),
  to_user: z.number().int().positive('To user ID is required'),
  amount: z.number().positive('Settlement amount must be greater than zero'),
});

// POST Settlement API Endpoint
app.post('/groups/:groupId/settle', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const validationResult = createSettlementSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { from_user, to_user, amount } = validationResult.data;

    if (from_user === to_user) {
      return res.status(400).json({ error: 'From user and To user cannot be the same' });
    }

    await client.query('BEGIN');

    const groupCheck = await client.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Group not found' });
    }

    const settlementQuery = `
      INSERT INTO settlements (group_id, from_user, to_user, amount)
      VALUES ($1, $2, $3, $4)
      RETURNING id, group_id, from_user, to_user, amount, created_at;
    `;
    const result = await client.query(settlementQuery, [groupId, from_user, to_user, amount]);
    const settlement = result.rows[0];

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Settlement recorded successfully',
      settlement,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error recording settlement:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET Group Balances Endpoint (Updated with settlements mapping)
app.get('/groups/:groupId/balances', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    // 1. Check if group exists
    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // 2. Get all members of the group
    const membersQuery = `
      SELECT u.id, u.name, u.email
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1;
    `;
    const membersResult = await pool.query(membersQuery, [groupId]);
    const members = membersResult.rows;

    if (members.length === 0) {
      return res.status(200).json({ balances: [] });
    }

    // 3. Calculate total paid by each user in this group
    const paidQuery = `
      SELECT paid_by AS user_id, SUM(amount) AS total_paid
      FROM expenses
      WHERE group_id = $1
      GROUP BY paid_by;
    `;
    const paidResult = await pool.query(paidQuery, [groupId]);

    // 4. Calculate total owed by each user from expense_splits in this group
    const owedQuery = `
      SELECT es.user_id, SUM(es.amount) AS total_owed
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = $1
      GROUP BY es.user_id;
    `;
    const owedResult = await pool.query(owedQuery, [groupId]);

    // 5. Settlements paid (from_user gives money)
    const settlementsPaidQuery = `
      SELECT from_user AS user_id, SUM(amount) AS total_settled_paid
      FROM settlements
      WHERE group_id = $1
      GROUP BY from_user;
    `;
    const settlementsPaidResult = await pool.query(settlementsPaidQuery, [groupId]);

    // 6. Settlements received (to_user receives money)
    const settlementsReceivedQuery = `
      SELECT to_user AS user_id, SUM(amount) AS total_settled_received
      FROM settlements
      WHERE group_id = $1
      GROUP BY to_user;
    `;
    const settlementsReceivedResult = await pool.query(settlementsReceivedQuery, [groupId]);

    // Map results into lookup objects
    const paidMap: { [key: number]: number } = {};
    paidResult.rows.forEach(row => { paidMap[row.user_id] = parseFloat(row.total_paid); });

    const owedMap: { [key: number]: number } = {};
    owedResult.rows.forEach(row => { owedMap[row.user_id] = parseFloat(row.total_owed); });

    const settledPaidMap: { [key: number]: number } = {};
    settlementsPaidResult.rows.forEach(row => { settledPaidMap[row.user_id] = parseFloat(row.total_settled_paid); });

    const settledReceivedMap: { [key: number]: number } = {};
    settlementsReceivedResult.rows.forEach(row => { settledReceivedMap[row.user_id] = parseFloat(row.total_settled_received); });

    // 7. Compute net balance for each member: (Paid + Settlements Paid) - (Owed + Settlements Received)
    const balances = members.map(member => {
      const totalPaid = paidMap[member.id] || 0;
      const totalOwed = owedMap[member.id] || 0;
      const settledPaid = settledPaidMap[member.id] || 0;
      const settledReceived = settledReceivedMap[member.id] || 0;

      const netBalance = (totalPaid + settledPaid) - (totalOwed + settledReceived);

      return {
        user_id: member.id,
        name: member.name,
        total_paid: totalPaid,
        total_owed: totalOwed,
        settled_paid: settledPaid,
        settled_received: settledReceived,
        net_balance: Number(netBalance.toFixed(2)),
      };
    });

    return res.status(200).json({
      group_id: groupId,
      balances,
    });
  } catch (error: any) {
    console.error('Error calculating balances:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Server listener at the VERY END
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});