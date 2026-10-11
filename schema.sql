-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Groups Table
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Group Members Mapping Table
CREATE TABLE IF NOT EXISTS group_members (
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

-- Expenses Table (amount is stored in paise, 100 paise = 1 rupee)
-- split_type is one of EQUAL, EXACT, PERCENT
-- Who paid lives in expense_payers, so one expense can have many payers
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    description TEXT NOT NULL,
    split_type VARCHAR(20) NOT NULL DEFAULT 'EQUAL',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Expense Payers Table (amount in paise): who paid how much for an expense
CREATE TABLE IF NOT EXISTS expense_payers (
    expense_id INT REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    PRIMARY KEY (expense_id, user_id)
);

-- Expense Splits Table (amount in paise): how much each person owes for an expense
CREATE TABLE IF NOT EXISTS expense_splits (
    expense_id INT REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    PRIMARY KEY (expense_id, user_id)
);

-- Settlements Table (amount in paise)
CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    from_user INT REFERENCES users(id),
    to_user INT REFERENCES users(id),
    amount INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'paid_by'
  ) THEN
  
    INSERT INTO expense_payers (expense_id, user_id, amount)
    SELECT id, paid_by, amount FROM expenses WHERE paid_by IS NOT NULL
    ON CONFLICT DO NOTHING;

    ALTER TABLE expenses DROP COLUMN paid_by;
  END IF;
END $$;