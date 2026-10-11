import express from 'express';
import type { Request, Response } from 'express';
import 'dotenv/config';
import { pool } from './db/db.js';
import { z } from 'zod';
import cors from 'cors';
import { computeShares, validatePayers, toPaise, toRupees } from './splits.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Money is stored in the database as integer paise (100 paise = 1 rupee).
// The API talks in rupees, so we convert at the edges.

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Expense Splitter API is running smoothly #sobercodes !' });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
});

app.get('/users', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY id;');
    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  description: z.string().optional(),
  created_by: z.number().int().positive('Valid creator user ID is required'),
  member_ids: z.array(z.number().int().positive()).optional(),
});

app.get('/groups', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, created_by, created_at FROM groups ORDER BY id;'
    );
    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error fetching groups:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a group with its first members. The creator is always a member.
app.post('/groups', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const validationResult = createGroupSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ error: validationResult.error.format() });
    }

    const { name, description, created_by, member_ids } = validationResult.data;

    const memberIds = Array.from(new Set([created_by, ...(member_ids ?? [])]));

    const usersCheck = await client.query('SELECT id FROM users WHERE id = ANY($1::int[])', [memberIds]);
    if (usersCheck.rows.length !== memberIds.length) {
      return res.status(404).json({ error: 'One or more selected people were not found' });
    }

    // Group and all its members are saved together or not at all
    await client.query('BEGIN');

    const groupQuery = `
      INSERT INTO groups (name, description, created_by) 
      VALUES ($1, $2, $3) 
      RETURNING id, name, description, created_by, created_at;
    `;
    const groupResult = await client.query(groupQuery, [name, description || null, created_by]);
    const newGroup = groupResult.rows[0];

    await client.query(
      'INSERT INTO group_members (group_id, user_id) SELECT $1::int, UNNEST($2::int[])',
      [newGroup.id, memberIds]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Group created successfully',
      group: newGroup,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating group:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Group members
// ---------------------------------------------------------------------------

const addMemberSchema = z.object({
  user_id: z.number().int().positive('Valid user ID is required'),
});

app.get('/groups/:groupId/members', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, gm.joined_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY u.name;`,
      [groupId]
    );

    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error fetching members:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
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

    const result = await pool.query(
      `INSERT INTO group_members (group_id, user_id) 
       VALUES ($1, $2) 
       RETURNING group_id, user_id, joined_at;`,
      [groupId, user_id]
    );

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

// Remove a member. Blocked if they already appear in an expense or settlement,
// because removing them would break the balances of everyone else.
app.delete('/groups/:groupId/members/:userId', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    const userId = Number(req.params.userId);
    if (isNaN(groupId) || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const usage = await pool.query(
      `SELECT 1 FROM expense_payers p JOIN expenses e ON e.id = p.expense_id
         WHERE e.group_id = $1 AND p.user_id = $2
       UNION ALL
       SELECT 1 FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
         WHERE e.group_id = $1 AND s.user_id = $2
       UNION ALL
       SELECT 1 FROM settlements
         WHERE group_id = $1 AND (from_user = $2 OR to_user = $2)
       LIMIT 1;`,
      [groupId, userId]
    );
    if (usage.rows.length > 0) {
      return res.status(409).json({
        error: 'This person already has expenses in this group, so they cannot be removed',
      });
    }

    const result = await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id',
      [groupId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This person is not a member of the group' });
    }

    return res.status(200).json({ message: 'Member removed from group' });
  } catch (error: any) {
    console.error('Error removing member:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Expenses (multiple payers, equal / exact / percentage splits)
// ---------------------------------------------------------------------------

const createExpenseSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  split_type: z.enum(['EQUAL', 'EXACT', 'PERCENT']).default('EQUAL'),
  payers: z
    .array(
      z.object({
        user_id: z.number().int().positive(),
        amount: z.number().positive(),
      })
    )
    .min(1, 'At least one payer is required'),
  splits: z
    .array(
      z.object({
        user_id: z.number().int().positive(),
        value: z.number().positive().optional(),
      })
    )
    .min(1, 'At least one person is required in the split'),
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

    const { description, amount, split_type, payers, splits } = validationResult.data;
    const totalPaise = toPaise(amount);

    // Work out exact paise for payers and for each person in the split
    const payerResult = validatePayers(totalPaise, payers);
    if (!payerResult.ok) {
      return res.status(400).json({ error: payerResult.error });
    }

    const shareResult = computeShares(split_type, totalPaise, splits);
    if (!shareResult.ok) {
      return res.status(400).json({ error: shareResult.error });
    }

    const payerRows = payerResult.data;
    const shareRows = shareResult.data;

    const groupCheck = await client.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Everyone involved has to be a member of this group
    const memberResult = await client.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
    const memberSet = new Set<number>(memberResult.rows.map(row => row.user_id));
    const outsiders = [...payerRows, ...shareRows].filter(row => !memberSet.has(row.user_id));
    if (outsiders.length > 0) {
      return res.status(400).json({ error: 'Everyone who paid or shares the cost must be a member of this group' });
    }

    await client.query('BEGIN');

    const expenseResult = await client.query(
      `INSERT INTO expenses (group_id, description, amount, split_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, group_id, description, amount, split_type, created_at;`,
      [groupId, description, totalPaise, split_type]
    );
    const expense = expenseResult.rows[0];

    for (const payer of payerRows) {
      await client.query('INSERT INTO expense_payers (expense_id, user_id, amount) VALUES ($1, $2, $3)', [
        expense.id,
        payer.user_id,
        payer.amount,
      ]);
    }

    for (const share of shareRows) {
      await client.query('INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)', [
        expense.id,
        share.user_id,
        share.amount,
      ]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Expense added and split successfully',
      expense: { ...expense, amount: toRupees(expense.amount) },
      payers: payerRows.map(p => ({ user_id: p.user_id, amount: toRupees(p.amount) })),
      splits: shareRows.map(s => ({ user_id: s.user_id, amount: toRupees(s.amount) })),
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error adding expense:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

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
        e.split_type,
        e.created_at,
        COALESCE((
          SELECT json_agg(json_build_object('user_id', p.user_id, 'name', u.name, 'amount', p.amount) ORDER BY u.name)
          FROM expense_payers p
          JOIN users u ON u.id = p.user_id
          WHERE p.expense_id = e.id
        ), '[]'::json) AS payers,
        COALESCE((
          SELECT json_agg(json_build_object('user_id', s.user_id, 'name', u.name, 'amount', s.amount) ORDER BY u.name)
          FROM expense_splits s
          JOIN users u ON u.id = s.user_id
          WHERE s.expense_id = e.id
        ), '[]'::json) AS splits
      FROM expenses e
      WHERE e.group_id = $1
      ORDER BY e.created_at DESC, e.id DESC;
    `;

    const result = await pool.query(query, [groupId]);

    const toRupeeLine = (line: { user_id: number; name: string; amount: number }) => ({
      ...line,
      amount: toRupees(line.amount),
    });

    return res.status(200).json({
      expenses: result.rows.map(row => ({
        ...row,
        amount: toRupees(row.amount),
        payers: row.payers.map(toRupeeLine),
        splits: row.splits.map(toRupeeLine),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching expenses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

const createSettlementSchema = z.object({
  from_user: z.number().int().positive('From user ID is required'),
  to_user: z.number().int().positive('To user ID is required'),
  amount: z.number().positive('Settlement amount must be greater than zero'),
});

app.post('/groups/:groupId/settle', async (req: Request, res: Response) => {
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

    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const memberCheck = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
      [groupId, [from_user, to_user]]
    );
    if (memberCheck.rows.length !== 2) {
      return res.status(400).json({ error: 'Both people must be members of this group' });
    }

    const result = await pool.query(
      `INSERT INTO settlements (group_id, from_user, to_user, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING id, group_id, from_user, to_user, amount, created_at;`,
      [groupId, from_user, to_user, toPaise(amount)]
    );
    const settlement = result.rows[0];

    return res.status(201).json({
      message: 'Settlement recorded successfully',
      settlement: { ...settlement, amount: toRupees(settlement.amount) },
    });
  } catch (error: any) {
    console.error('Error recording settlement:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

app.get('/groups/:groupId/balances', async (req: Request, res: Response) => {
  try {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY u.id;`,
      [groupId]
    );
    const members = membersResult.rows;

    if (members.length === 0) {
      return res.status(200).json({ group_id: groupId, balances: [] });
    }

    // Total paid by each user (an expense can have several payers)
    const paidResult = await pool.query(
      `SELECT p.user_id, SUM(p.amount) AS total
       FROM expense_payers p
       JOIN expenses e ON e.id = p.expense_id
       WHERE e.group_id = $1
       GROUP BY p.user_id;`,
      [groupId]
    );

    // Total share each user owes across all expenses
    const owedResult = await pool.query(
      `SELECT es.user_id, SUM(es.amount) AS total
       FROM expense_splits es
       JOIN expenses e ON es.expense_id = e.id
       WHERE e.group_id = $1
       GROUP BY es.user_id;`,
      [groupId]
    );

    // Settlements: from_user gave money, to_user received money
    const settledPaidResult = await pool.query(
      `SELECT from_user AS user_id, SUM(amount) AS total
       FROM settlements
       WHERE group_id = $1
       GROUP BY from_user;`,
      [groupId]
    );

    const settledReceivedResult = await pool.query(
      `SELECT to_user AS user_id, SUM(amount) AS total
       FROM settlements
       WHERE group_id = $1
       GROUP BY to_user;`,
      [groupId]
    );

    // Lookup maps (all values in integer paise)
    const toMap = (rows: { user_id: number; total: string }[]) => {
      const map: { [key: number]: number } = {};
      rows.forEach(row => {
        map[row.user_id] = Number(row.total);
      });
      return map;
    };

    const paidMap = toMap(paidResult.rows);
    const owedMap = toMap(owedResult.rows);
    const settledPaidMap = toMap(settledPaidResult.rows);
    const settledReceivedMap = toMap(settledReceivedResult.rows);

    // Net balance = (Paid + Settlements Paid) - (Share Owed + Settlements Received)
    // Calculated in paise, converted to rupees only for the response.
    const balances = members.map(member => {
      const totalPaid = paidMap[member.id] || 0;
      const totalOwed = owedMap[member.id] || 0;
      const settledPaid = settledPaidMap[member.id] || 0;
      const settledReceived = settledReceivedMap[member.id] || 0;

      const netPaise = totalPaid + settledPaid - (totalOwed + settledReceived);

      return {
        user_id: member.id,
        name: member.name,
        total_paid: toRupees(totalPaid),
        total_owed: toRupees(totalOwed),
        settled_paid: toRupees(settledPaid),
        settled_received: toRupees(settledReceived),
        net_balance: toRupees(netPaise),
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