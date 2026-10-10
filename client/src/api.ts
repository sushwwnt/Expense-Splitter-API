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

export interface Balance {
  user_id: number;
  name: string;
  total_paid: number;
  total_owed: number;
  settled_paid: number;
  settled_received: number;
  net_balance: number;
}

// API Functions
export const getUsers = () => API.get<User[]>("/users");
export const createUser = (data: { name: string; email: string }) => API.post("/users", data);

export const getGroups = () => API.get<Group[]>("/groups");
export const createGroup = (data: { name: string; description?: string; created_by: number }) =>
  API.post("/groups", data);

export const getGroupBalances = (groupId: number) =>
  API.get<{ group_id: number; balances: Balance[] }>(`/groups/${groupId}/balances`);

export const addExpense = (groupId: number, data: {
  description: string;
  amount: number;
  paid_by: number;
  splits: { user_id: number; amount: number }[];
}) => API.post(`/groups/${groupId}/expenses`, data);

export const settleUp = (groupId: number, data: {
  from_user: number;
  to_user: number;
  amount: number;
}) => API.post(`/groups/${groupId}/settle`, data);