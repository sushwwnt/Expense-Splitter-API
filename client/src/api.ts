import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:3000",
});

// Types
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Group {
  id: number;
  name: string;
  description?: string;
  created_by: number;
}

export interface GroupMember {
  id: number;
  name: string;
  email: string;
  joined_at: string;
}

export interface Balance {
  user_id: number;
  name: string;
  total_paid: number;
  total_owed: number;
  settled_paid: number;
  settled_received: number;
  net_balance: number;
}

export type SplitType = "EQUAL" | "EXACT" | "PERCENT";

// One line of an expense: a person and how much they paid or owe
export interface ExpenseLine {
  user_id: number;
  name: string;
  amount: number;
}

export interface Expense {
  id: number;
  group_id: number;
  description: string;
  amount: number;
  split_type: SplitType;
  created_at: string;
  payers: ExpenseLine[];
  splits: ExpenseLine[];
}

// What the frontend sends when adding an expense.
// For splits, value is rupees for EXACT, percent for PERCENT and left out for EQUAL.
export interface NewExpense {
  description: string;
  amount: number;
  split_type: SplitType;
  payers: { user_id: number; amount: number }[];
  splits: { user_id: number; value?: number }[];
}

// API Functions
export const getUsers = () => API.get<User[]>("/users");
export const createUser = (data: { name: string; email: string }) => API.post("/users", data);

export const getGroups = () => API.get<Group[]>("/groups");
export const createGroup = (data: {
  name: string;
  description?: string;
  created_by: number;
  member_ids?: number[];
}) => API.post("/groups", data);

export const getGroupMembers = (groupId: number) => API.get<GroupMember[]>(`/groups/${groupId}/members`);
export const addGroupMember = (groupId: number, userId: number) =>
  API.post(`/groups/${groupId}/members`, { user_id: userId });
export const removeGroupMember = (groupId: number, userId: number) =>
  API.delete(`/groups/${groupId}/members/${userId}`);

export const getGroupBalances = (groupId: number) =>
  API.get<{ group_id: number; balances: Balance[] }>(`/groups/${groupId}/balances`);

export const getGroupExpenses = (groupId: number) =>
  API.get<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`);

export const addExpense = (groupId: number, data: NewExpense) => API.post(`/groups/${groupId}/expenses`, data);

export const settleUp = (groupId: number, data: {
  from_user: number;
  to_user: number;
  amount: number;
}) => API.post(`/groups/${groupId}/settle`, data);