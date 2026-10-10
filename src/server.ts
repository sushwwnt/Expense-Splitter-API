import express, { Request, Response } from 'express';
import 'dotenv/config';
import { pool } from './db/db.js';
import { z } from 'zod';

const app = express();
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

// Server listener at the VERY END
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});