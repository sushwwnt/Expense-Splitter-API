# 💰 Expense Splitter

A production-grade, full-stack expense management and splitting application designed to eliminate floating-point calculation errors and simplify group finances. Built with modern web technologies, it features dynamic group membership, multi-payer support, and precise balance tracking using integer-based financial arithmetic.

---

## ✨ Key Features

- **Exact Financial Precision**: All monetary values are calculated and stored as integer paise (100 paise = ₹1) on the backend to eliminate floating-point rounding drift.
- **Multiple Payers per Bill**: Unlike traditional single-payer apps, a single expense can be paid jointly by multiple members in varying amounts.
- **Custom & Equal Split Modes**: Flexibility to split bills equally among group members or assign exact custom split amounts per person.
- **Dynamic Group Membership**: Create groups with tailored member lists and invite users on demand.
- **Automated Settlement Suggestions**: Smart balance calculation engine that computes net balances and generates the minimal number of payments needed to settle up.
- **Clean & Modern UI**: Built with React, Tailwind CSS, and Lucide Icons following a sleek, minimal dark-mode sidebar layout.

---

## 🛠️ Tech Stack

### **Backend**
- **Runtime**: Node.js & Express with TypeScript
- **Database**: PostgreSQL
- **Database Driver**: `pg` (node-postgres)
- **Validation**: Zod (type-safe request payload validation)
- **CORS & Environment**: `cors`, `dotenv`

### **Frontend**
- **Framework**: React (TypeScript)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Build Tool**: Vite

---

## 📊 Database Schema Overview

The database is fully normalized to handle complex splitting logic:
- `users`: Stores user profiles.
- `groups`: Stores group metadata.
- `group_members`: Junction table mapping dynamic memberships between users and groups.
- `expenses`: Stores main expense metadata.
- `expense_payers`: Stores exact contribution per payer for a single expense in paise.
- `expense_splits`: Stores exact owed split per member for an expense in paise.
- `settlements`: Tracks peer-to-peer payments between users to balance accounts.

---

## ⚡ Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL installed and running

### 1. Database Setup
Execute the queries in `schema.sql` inside your PostgreSQL instance to initialize tables and constraints.

### 2. Backend Setup
```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Setup .env file
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/expense_db

# Start development server
npm run dev
```
### 3. Frontend Setup

```bash
# Navigate to client directory (in a new terminal panel)
cd client

# Install dependencies
npm install

# Start Vite development server
npm run dev  
